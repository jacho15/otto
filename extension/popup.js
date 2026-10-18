'use strict'

const DEFAULTS = { server: 'http://localhost:8000', web: 'http://localhost:5173' }
const MAX_HTML = 3000000
const LIMITS = { w: [5, 600], d: [5, 600], h: [5, 350] } // cm
const INCH_CM = 2.54

const $ = (id) => document.getElementById(id)

let settings = { ...DEFAULTS }
let tabId = null
let tabUrl = ''
let draft = null
let unit = 'cm'
let busy = false
let loadCount = 0

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function setStatus(message, kind = '') {
  const node = $('status')
  node.textContent = message
  node.className = `status ${kind}`.trim()
}

function setBusy(value) {
  busy = value
  $('put').disabled = value
  $('keep').disabled = value
}

// An http(s) address as scheme://host:port, or null.
function cleanUrl(value) {
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
}

function detailText(detail, status) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0] && typeof detail[0].msg === 'string') {
    const where = Array.isArray(detail[0].loc) ? detail[0].loc.slice(1).join(' ') : ''
    return where ? `${where}: ${detail[0].msg}` : detail[0].msg
  }
  return `Otto answered with error ${status}.`
}

async function api(path, body) {
  const init = body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  let res
  try {
    res = await fetch(settings.server + path, init)
  } catch {
    throw new Error(`Can't reach Otto. Is the server running at ${settings.server}?`)
  }
  if (!res.ok) {
    let detail
    try {
      detail = (await res.json()).detail
    } catch {
      detail = undefined
    }
    throw new ApiError(res.status, detailText(detail, res.status))
  }
  return res.json()
}

// Ask the server to read the page. If the shop blocks the server, send the page the tab is showing.
async function readDraft() {
  try {
    return await api('/api/import/link', { url: tabUrl })
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 502 && e.status !== 422)) throw e
  }
  let html
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML.slice(0, 3000000),
    })
    html = result && result.result
  } catch {
    throw new Error("Can't read this page.")
  }
  if (typeof html !== 'string' || !html) throw new Error("Can't read this page.")
  return api('/api/import/page', { url: tabUrl, html: html.slice(0, MAX_HTML) })
}

function blankDraft() {
  return {
    title: '',
    price: null,
    currency: 'USD',
    image_url: null,
    size: null,
    label: 'furniture',
    notes: ["Couldn't find a product on this page. Enter it by hand."],
  }
}

function round(value, places) {
  const f = 10 ** places
  return Math.round(value * f) / f
}

function setUnit(next) {
  const factor = unit === next ? 1 : unit === 'cm' ? 1 / INCH_CM : INCH_CM
  for (const id of ['w', 'd', 'h']) {
    const value = Number($(id).value)
    if ($(id).value.trim() !== '' && Number.isFinite(value)) $(id).value = round(value * factor, next === 'cm' ? 1 : 2)
  }
  unit = next
  for (const button of document.querySelectorAll('.unit')) {
    button.classList.toggle('on', button.dataset.unit === unit)
  }
}

function showPhoto(url) {
  const img = $('photo')
  img.hidden = true
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
  img.referrerPolicy = 'no-referrer'
  img.onload = () => { img.hidden = false }
  img.onerror = () => { img.hidden = true }
  img.src = url
}

function fillRooms(rooms, last) {
  const select = $('room')
  select.textContent = ''
  for (const room of rooms) {
    const option = document.createElement('option')
    option.value = room.id
    option.textContent = room.name
    select.appendChild(option)
  }
  if (rooms.some((r) => r.id === last)) select.value = last
  $('put').hidden = rooms.length === 0
}

function showForm(d, rooms, lastRoom) {
  draft = d
  $('title').value = d.title || ''
  $('price').value = d.price == null ? '' : d.price
  $('currency').value = d.currency || 'USD'
  const type = $('label')
  const label = d.label || 'furniture'
  if (![...type.options].some((o) => o.value === label)) {
    const option = document.createElement('option')
    option.value = label
    option.textContent = label
    type.appendChild(option)
  }
  type.value = label
  unit = 'cm'
  for (const button of document.querySelectorAll('.unit')) button.classList.toggle('on', button.dataset.unit === 'cm')
  const size = Array.isArray(d.size) && d.size.length === 3 ? d.size : null
  ;['w', 'd', 'h'].forEach((id, i) => {
    $(id).value = size ? round(size[i] * 100, 1) : ''
  })
  $('notes').textContent = Array.isArray(d.notes) ? d.notes.join(' ') : ''
  showPhoto(d.image_url)
  fillRooms(rooms, lastRoom)
  $('form').hidden = false
  if (rooms.length === 0) setStatus('No rooms yet. Make one in Otto to place items. You can still save this one.')
}

// Read and check the form. Returns the body for POST /api/custom-items, or throws a readable error.
function collect() {
  const title = $('title').value.trim()
  if (!title) throw new Error('Add a title.')
  if (title.length > 120) throw new Error('The title can be 120 characters at most.')
  let price = null
  if ($('price').value.trim() !== '') {
    price = Number($('price').value)
    if (!Number.isFinite(price) || price < 0) throw new Error('Price must be 0 or more.')
  }
  const currency = $('currency').value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency is 3 letters, like USD.')
  const names = { w: 'Width', d: 'Depth', h: 'Height' }
  const size = []
  for (const id of ['w', 'd', 'h']) {
    const raw = $(id).value.trim()
    const value = raw === '' ? NaN : Number(raw)
    if (!Number.isFinite(value)) throw new Error(`Enter the ${names[id].toLowerCase()}.`)
    const cm = unit === 'in' ? value * INCH_CM : value
    const [min, max] = LIMITS[id]
    if (cm < min || cm > max) throw new Error(`${names[id]} must be ${min} to ${max} cm.`)
    size.push(round(cm / 100, 3))
  }
  const image = draft && typeof draft.image_url === 'string' && draft.image_url.length <= 2000 ? draft.image_url : null
  return {
    title,
    url: tabUrl.length <= 2000 ? tabUrl : null,
    price,
    currency,
    size,
    label: $('label').value,
    image_url: image,
  }
}

async function submit(place) {
  if (busy) return
  setStatus('')
  let item
  try {
    item = collect()
  } catch (e) {
    return setStatus(e.message, 'error')
  }
  const room = $('room').value
  if (place && !room) return setStatus('Pick a room first.', 'error')
  setBusy(true)
  try {
    let created
    try {
      created = await api('/api/custom-items', item)
    } catch (e) {
      return setStatus(e.message, 'error')
    }
    const notes = Array.isArray(created.notes) ? ` ${created.notes.join(' ')}` : ''
    if (!place) return setStatus(`Saved.${notes}`, 'ok')
    try {
      const added = await api(`/api/rooms/${encodeURIComponent(room)}/objects`, { catalog_id: created.id })
      const link = `${settings.web}/rooms/${encodeURIComponent(room)}?select=${encodeURIComponent(added.added)}`
      await chrome.tabs.create({ url: link })
      setStatus('Added to your room.', 'ok')
    } catch (e) {
      setStatus(`Saved to your items, but couldn't add it to the room. ${e.message}`, 'error')
    }
  } finally {
    setBusy(false)
  }
}

async function load() {
  const run = ++loadCount
  $('form').hidden = true
  setStatus('')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || typeof tab.url !== 'string' || !/^https?:\/\//i.test(tab.url)) {
    return setStatus('Open a product page first.')
  }
  tabId = tab.id
  tabUrl = tab.url
  setStatus('Reading the page…')
  try {
    const rooms = await api('/api/rooms')
    let d
    try {
      d = await readDraft()
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 422)) throw e
      d = blankDraft()
    }
    if (run !== loadCount) return
    const { room } = await chrome.storage.local.get('room')
    setStatus('')
    showForm(d, rooms, room)
  } catch (e) {
    if (run === loadCount) setStatus(e.message, 'error')
  }
}

async function saveSettings() {
  const note = $('settings-status')
  const server = cleanUrl($('server').value)
  const web = cleanUrl($('web').value)
  if (!server || !web) {
    note.textContent = 'Use http or https addresses, like http://localhost:8000.'
    note.className = 'status error'
    return
  }
  settings = { server, web }
  await chrome.storage.local.set(settings)
  $('server').value = server
  $('web').value = web
  note.textContent = 'Saved.'
  note.className = 'status ok'
  load()
}

async function init() {
  const stored = await chrome.storage.local.get(['server', 'web'])
  settings = {
    server: cleanUrl(stored.server || '') || DEFAULTS.server,
    web: cleanUrl(stored.web || '') || DEFAULTS.web,
  }
  $('server').value = settings.server
  $('web').value = settings.web

  $('gear').addEventListener('click', () => {
    const open = $('settings').hidden
    $('settings').hidden = !open
    $('gear').setAttribute('aria-expanded', String(open))
  })
  $('save-settings').addEventListener('click', saveSettings)
  for (const button of document.querySelectorAll('.unit')) {
    button.addEventListener('click', () => setUnit(button.dataset.unit))
  }
  $('room').addEventListener('change', () => chrome.storage.local.set({ room: $('room').value }))
  $('form').addEventListener('submit', (e) => {
    e.preventDefault()
    submit(true)
  })
  $('keep').addEventListener('click', () => submit(false))
  load()
}

init()
