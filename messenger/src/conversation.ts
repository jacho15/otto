// What otto says back in a text conversation. No Photon and no network here: otto's API is passed in,
// and replies are plain values, so the whole flow can be tested.
//
// Send a photo  -> otto puts the closest piece in your room and sends its photo, a picture and a short
//                   walk-around video of your room with it, and the other options with their photos.
// Reply 2 or 3  -> swaps in that option instead. "keep" keeps it; "undo" takes it out.
// "black leather" -> looks again at the last photo, steered by what you said. Words sent with a photo steer it too.
// "rooms" / "room 2" -> choose which room to try things in. Anything else is chat, and gets a short nudge.

export interface Match {
  id: string
  title: string
  label: string
  source: 'catalog' | 'ikea' // ikea: found live on IKEA, not in otto's catalog yet
  url: string // where to buy it
  price: number | null // null when the shop page didn't show one
  currency: string
  size: [number, number, number]
  photo_url: string | null // the product photo, on otto's API (catalog pieces)
  image_url?: string | null // the product photo on IKEA (live finds)
  rgba?: number[] | null // the colour to draw it in when it has no 3D model
  why: string
  fits?: boolean
  problems?: string[]
}

export interface MatchResult {
  features: { found: boolean; type: string; description: string }
  matches: Match[]
  message: string
}

export interface RoomSummary {
  id: string
  name: string
}

/** The parts of otto's API a conversation uses. */
export interface Otto {
  /** Catalog and live IKEA matches for a photo. `note` is what the person said about it. */
  matchPhoto(photo: Buffer, mimeType: string, roomId: string, note?: string): Promise<MatchResult>
  addPiece(roomId: string, match: Match): Promise<string> // the new piece's name
  removePiece(roomId: string, name: string): Promise<void>
  renderRoom(roomId: string, select: string): Promise<Buffer> // PNG
  renderTour(roomId: string, focus: string): Promise<Buffer> // MP4: a few seconds walking around the piece
  fetchFile(url: string): Promise<Buffer>
  listRooms(): Promise<RoomSummary[]>
}

/** Text, or a file to attach: a photo or a video. */
export type Reply = { text: string } | { media: Buffer; mimeType: string; name: string }

export interface Placed {
  roomId: string
  name: string // the piece's name in the room
  matchId: string // which catalog piece it is
  title: string
  kept: boolean // kept pieces stay when the next photo comes in
}

export interface State {
  roomId: string
  matches: Match[]
  placed: Placed | null
  greeted: boolean
  lastPhoto: { bytes: Buffer; mimeType: string } | null // so "black leather" can look again
}

export type Incoming =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; read: () => Promise<Buffer>; mimeType: string; note?: string } // note: words sent with it

export const newState = (roomId: string): State => ({ roomId, matches: [], placed: null, greeted: false, lastPhoto: null })

// ---- understanding replies ----

export type Intent =
  | { kind: 'choice'; n: number }
  | { kind: 'undo' }
  | { kind: 'keep' }
  | { kind: 'rooms' }
  | { kind: 'room'; n: number }
  | { kind: 'refine' } // a colour, material or style to look for instead
  | { kind: 'chat' }

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, one: 1, two: 2, three: 3 }
// words that make a bare number a choice: "show me 2", "lets try 3", "go with number 2"
const CHOICE_CUES = /\b(show|pick|try|option|number|no|want|do|go|with|lets|let's|swap|see|that|this|the|one)\b|#/

const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9#' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// words that describe what to look for: "black leather", "in walnut", "something velvet"
const LOOKS =
  /\b(black|white|grey|gray|beige|brown|red|blue|green|yellow|pink|navy|cream|tan|leather|faux|wood|wooden|oak|walnut|pine|metal|chrome|steel|brass|fabric|velvet|linen|boucle|rattan|wicker|glass|marble|plastic|modern|vintage|mid ?century|scandinavian|minimal(ist)?|industrial|rustic|cheaper|bigger|smaller)\b/

/** True when a text says what to look for, not just chat. */
export const describesLooks = (raw: string) => LOOKS.test(clean(raw))

/** What a reply asks for, allowing filler words ("yeah 2 pls", "nah take it out", "these look fire"). */
export function intentOf(raw: string, matchCount: number): Intent {
  const t = clean(raw)
  if (/\b(undo|take (it|that|this) (out|back|away)|remove (it|that|this)|never ?mind|get rid of (it|that|this))\b/.test(t)) return { kind: 'undo' }
  if (/\b(keep (it|that|this)|i'?ll take (it|that|this)|love (it|that|this)|that'?s perfect|perfect)\b/.test(t)) return { kind: 'keep' }
  const room = t.match(/\broom\s*#?\s*(\d+)\b/)
  if (room) return { kind: 'room', n: Number(room[1]) }
  if (/\b(rooms|my rooms|which rooms|list rooms|other rooms?)\b/.test(t)) return { kind: 'rooms' }
  if (matchCount > 0) {
    const digits = t.match(/\b([1-9])\b/g) ?? []
    const words = t.split(' ')
    if (digits.length === 1 && (words.length <= 3 || CHOICE_CUES.test(t))) {
      const n = Number(digits[0])
      if (n <= matchCount) return { kind: 'choice', n }
    }
    // "the second one": the earliest number word wins, so "second" beats the trailing "one"
    const named = Object.entries(ORDINALS)
      .map(([w, v]) => ({ at: t.search(new RegExp(`\\b${w}\\b`)), v }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
    if (named.length && digits.length === 0 && named[0].v <= matchCount) return { kind: 'choice', n: named[0].v }
  }
  if (describesLooks(t)) return { kind: 'refine' }
  return { kind: 'chat' }
}

/**
 * Messages that arrive together (a photo and "these chairs look fire") are one thought.
 * A photo wins and its text is just a comment; otherwise the last text that asks for something, else the last text.
 */
export function combine(batch: Incoming[], matchCount: number): Incoming | null {
  const photo = batch.find((m): m is Extract<Incoming, { kind: 'photo' }> => m.kind === 'photo')
  if (photo) {
    // what they wrote with it steers the search: "black leather ones", "this but in oak"
    const note = batch
      .filter((m): m is Extract<Incoming, { kind: 'text' }> => m.kind === 'text')
      .map((m) => m.text.trim())
      .filter(Boolean)
      .join(' ')
    return note ? { ...photo, note } : photo
  }
  const texts = batch.filter((m): m is Extract<Incoming, { kind: 'text' }> => m.kind === 'text')
  const asking = [...texts].reverse().find((m) => intentOf(m.text, matchCount).kind !== 'chat')
  return asking ?? texts.at(-1) ?? null
}

// ---- wording ----

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

/** "$199.00", or a pointer to the shop when the price is unknown. */
export const priceOf = (m: Match) => (m.price == null ? 'price on IKEA' : money(m.price, m.currency))

/** A file's type from its first bytes. */
export function mediaType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}

const cm = (size: [number, number, number]) => size.map((v) => Math.round(v * 100)).join(' × ') + ' cm'

export function matchLine(m: Match, n: number): string {
  const fit = m.fits === undefined ? '' : m.fits ? '' : ` · won't fit: ${(m.problems ?? [])[0]?.toLowerCase() ?? 'no space'}`
  return `${n}. ${m.title}: ${priceOf(m)} · ${cm(m.size)}${fit}${m.url ? `\nBuy it: ${m.url}` : ''}`
}

/** "Demo Living Room" -> "your living room". */
export function roomPhrase(name: string | undefined): string {
  if (!name) return 'your room'
  return `your ${name.replace(/^demo\s+/i, '').toLowerCase()}`
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

const HELP = "Send me a photo of a piece of furniture you like, and I'll show you what something like it would look like in your room."

// ---- the conversation ----

export interface Turn {
  state: State
  replies: Reply[]
}

/** One incoming message in, the new state and what to send back out. */
export async function respond(otto: Otto, state: State, msg: Incoming): Promise<Turn> {
  try {
    if (msg.kind === 'photo') return await onPhoto(otto, state, msg)
    return await onText(otto, state, msg.text)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { state, replies: [{ text: `Something went wrong: ${reason}` }] }
  }
}

async function roomName(otto: Otto, roomId: string): Promise<string | undefined> {
  try {
    return (await otto.listRooms()).find((r) => r.id === roomId)?.name
  } catch {
    return undefined
  }
}

/** The piece's product photo, or nothing if it can't be had. */
async function productPhoto(otto: Otto, m: Match): Promise<Reply | null> {
  const url = m.photo_url ?? m.image_url
  if (!url) return null
  try {
    const bytes = await otto.fetchFile(url)
    const mimeType = mediaType(bytes)
    return { media: bytes, mimeType, name: `${m.id}.${mimeType.split('/')[1]}` }
  } catch {
    return null
  }
}

/** Put a match in the room (replacing the last trial piece), then picture and film it, both at once. */
async function tryPiece(otto: Otto, state: State, m: Match): Promise<{ placed: Placed; picture: Reply | null; tour: Reply | null }> {
  if (state.placed && !state.placed.kept) await otto.removePiece(state.placed.roomId, state.placed.name)
  const name = await otto.addPiece(state.roomId, m)
  // either can fail on its own; the piece is in the room regardless and the text says so
  const [picture, tour] = await Promise.all([
    otto.renderRoom(state.roomId, name).then((b): Reply => ({ media: b, mimeType: 'image/png', name: 'your-room.png' }), () => null),
    otto.renderTour(state.roomId, name).then((b): Reply => ({ media: b, mimeType: 'video/mp4', name: 'walk-around.mp4' }), () => null),
  ])
  return { placed: { roomId: state.roomId, name, matchId: m.id, title: m.title, kept: false }, picture, tour }
}

async function onPhoto(otto: Otto, state: State, msg: Extract<Incoming, { kind: 'photo' }>): Promise<Turn> {
  if (!msg.mimeType.startsWith('image/')) return { state, replies: [{ text: "Send a photo (JPEG, PNG or WebP) and I'll look for it." }] }
  const bytes = await msg.read()
  state = { ...state, lastPhoto: { bytes, mimeType: msg.mimeType } }
  const result = await otto.matchPhoto(bytes, msg.mimeType, state.roomId, msg.note)
  if (!result.matches.length) return { state: { ...state, matches: [], greeted: true }, replies: [{ text: result.message }] }

  const [best, ...others] = result.matches
  const [{ placed, picture, tour }, bestPhoto, otherPhotos, name] = await Promise.all([
    tryPiece(otto, state, best),
    productPhoto(otto, best),
    Promise.all(others.map((m) => productPhoto(otto, m))),
    roomName(otto, state.roomId),
  ])
  const where = roomPhrase(name)
  const desc = result.features.description.replace(/^(a|an)\s+/i, '')
  const fit = best.fits === false ? ` Heads up: it ${(best.problems ?? ['may not fit'])[0].toLowerCase()}.` : ''
  const replies: Reply[] = [
    { text: `That looks like ${article(desc)} ${desc}. The closest I have is the ${best.title}: ${priceOf(best)} · ${cm(best.size)}.${fit}${best.url ? `\nBuy it: ${best.url}` : ''}` },
  ]
  if (bestPhoto) replies.push(bestPhoto)
  if (picture || tour) replies.push({ text: `This is what it would look like in ${where}:` })
  else replies.push({ text: `I put it in ${where}, but couldn't draw the room just now.` })
  if (picture) replies.push(picture)
  if (tour) replies.push(tour)
  if (others.length) {
    replies.push({ text: 'Other options:' })
    others.forEach((m, i) => {
      replies.push({ text: matchLine(m, i + 2) })
      const photo = otherPhotos[i]
      if (photo) replies.push(photo)
    })
    replies.push({ text: `Reply ${others.length === 1 ? '2' : '2 or 3'} to swap, "keep" to keep it, or "undo" to take it out.` })
  } else {
    replies.push({ text: 'Reply "keep" to keep it, or "undo" to take it out.' })
  }
  return { state: { ...state, matches: result.matches, placed, greeted: true }, replies }
}

async function onText(otto: Otto, state: State, raw: string): Promise<Turn> {
  const intent = intentOf(raw, state.matches.length)

  if (intent.kind === 'undo') {
    if (!state.placed) return { state, replies: [{ text: "There's nothing to undo yet." }] }
    await otto.removePiece(state.placed.roomId, state.placed.name)
    return { state: { ...state, placed: null }, replies: [{ text: `Took the ${state.placed.title} back out.` }] }
  }

  if (intent.kind === 'keep') {
    if (!state.placed) return { state, replies: [{ text: 'Send me a photo first, and I\'ll find something to try.' }] }
    if (state.placed.kept) return { state, replies: [{ text: `The ${state.placed.title} is staying in your room.` }] }
    return {
      state: { ...state, placed: { ...state.placed, kept: true } },
      replies: [{ text: `Kept the ${state.placed.title} in your room. Send another photo to keep going.` }],
    }
  }

  if (intent.kind === 'rooms') {
    const rooms = await otto.listRooms()
    const list = rooms.map((r, i) => `${i + 1}. ${r.name}${r.id === state.roomId ? ' (current)' : ''}`).join('\n')
    return { state, replies: [{ text: `Your rooms:\n${list}\nReply "room 2" to switch.` }] }
  }

  if (intent.kind === 'room') {
    const rooms = await otto.listRooms()
    const room = rooms[intent.n - 1]
    if (!room) return { state, replies: [{ text: `There's no room ${intent.n}. Reply "rooms" to see them.` }] }
    return { state: { ...state, roomId: room.id, matches: [], placed: null }, replies: [{ text: `Now trying things in ${room.name}. Send a photo.` }] }
  }

  if (intent.kind === 'refine') {
    if (!state.lastPhoto) {
      return { state: { ...state, greeted: true }, replies: [{ text: `Send me a photo and I'll look for ${raw.trim().toLowerCase()} ones like it.` }] }
    }
    const { bytes, mimeType } = state.lastPhoto
    return onPhoto(otto, state, { kind: 'photo', read: async () => bytes, mimeType, note: raw })
  }

  if (intent.kind === 'choice') {
    const m = state.matches[intent.n - 1]
    if (state.placed?.matchId === m.id && state.placed.roomId === state.roomId) {
      return { state, replies: [{ text: `The ${m.title} is already in your room.` }] }
    }
    const [{ placed, picture, tour }, name] = await Promise.all([tryPiece(otto, state, m), roomName(otto, state.roomId)])
    const where = roomPhrase(name)
    const fit = m.fits === false ? ` Heads up: it ${(m.problems ?? ['may not fit'])[0].toLowerCase()}.` : ''
    const shown = picture || tour
    const replies: Reply[] = [
      { text: `${shown ? `Here's the ${m.title} (${priceOf(m)}) in ${where}.` : `I put the ${m.title} in ${where}, but couldn't draw the room just now.`}${fit}` },
    ]
    if (picture) replies.push(picture)
    if (tour) replies.push(tour)
    return { state: { ...state, placed }, replies }
  }

  // chat: a short nudge, never a lecture
  if (state.matches.length) {
    const swap = state.matches.length > 1 ? `Reply ${state.matches.length === 2 ? '2' : '2 or 3'} to swap it, ` : 'Reply '
    return { state, replies: [{ text: `${swap}"keep" to keep it, or send another photo.` }] }
  }
  if (state.greeted) return { state, replies: [{ text: "Send me a photo whenever you're ready." }] }
  return { state: { ...state, greeted: true }, replies: [{ text: HELP }] }
}
