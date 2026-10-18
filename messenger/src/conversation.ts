// What otto says back in a text conversation. No Photon and no network here: otto's API is passed in,
// and replies are plain values, so the whole flow can be tested.
//
// Send a photo  -> otto puts the closest piece in your room and sends a picture of it, with other options.
// Reply 2 or 3  -> swaps in that option instead. "keep" keeps it; "undo" takes it out.
// "rooms" / "room 2" -> choose which room to try things in. Anything else is chat, and gets a short nudge.

export interface Match {
  id: string
  title: string
  price: number
  currency: string
  size: [number, number, number]
  photo_url: string | null // null for pieces without a product photo
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
  matchPhoto(photo: Buffer, mimeType: string, roomId: string): Promise<MatchResult>
  addPiece(roomId: string, catalogId: string): Promise<string> // the new piece's name
  removePiece(roomId: string, name: string): Promise<void>
  renderRoom(roomId: string, select: string): Promise<Buffer> // PNG
  listRooms(): Promise<RoomSummary[]>
}

export type Reply = { text: string } | { image: Buffer; mimeType: string; name: string }

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
}

export type Incoming = { kind: 'text'; text: string } | { kind: 'photo'; read: () => Promise<Buffer>; mimeType: string }

export const newState = (roomId: string): State => ({ roomId, matches: [], placed: null, greeted: false })

// ---- understanding replies ----

export type Intent =
  | { kind: 'choice'; n: number }
  | { kind: 'undo' }
  | { kind: 'keep' }
  | { kind: 'rooms' }
  | { kind: 'room'; n: number }
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
  return { kind: 'chat' }
}

/**
 * Messages that arrive together (a photo and "these chairs look fire") are one thought.
 * A photo wins and its text is just a comment; otherwise the last text that asks for something, else the last text.
 */
export function combine(batch: Incoming[], matchCount: number): Incoming | null {
  const photo = batch.find((m) => m.kind === 'photo')
  if (photo) return photo
  const texts = batch.filter((m): m is Extract<Incoming, { kind: 'text' }> => m.kind === 'text')
  const asking = [...texts].reverse().find((m) => intentOf(m.text, matchCount).kind !== 'chat')
  return asking ?? texts.at(-1) ?? null
}

// ---- wording ----

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

const cm = (size: [number, number, number]) => size.map((v) => Math.round(v * 100)).join(' × ') + ' cm'

export function matchLine(m: Match, n: number): string {
  const fit = m.fits === undefined ? '' : m.fits ? '' : ` · won't fit: ${(m.problems ?? [])[0]?.toLowerCase() ?? 'no space'}`
  return `${n}. ${m.title}: ${money(m.price, m.currency)} · ${cm(m.size)}${fit}`
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

/** One incoming message in, the new state and what to send back out. `publicUrl` is where the website lives. */
export async function respond(otto: Otto, state: State, msg: Incoming, publicUrl: string): Promise<Turn> {
  try {
    if (msg.kind === 'photo') return await onPhoto(otto, state, msg, publicUrl)
    return await onText(otto, state, msg.text, publicUrl)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { state, replies: [{ text: `Something went wrong: ${reason}` }] }
  }
}

const link3d = (publicUrl: string, roomId: string, name: string) =>
  `${publicUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(roomId)}?select=${encodeURIComponent(name)}`

async function roomName(otto: Otto, roomId: string): Promise<string | undefined> {
  try {
    return (await otto.listRooms()).find((r) => r.id === roomId)?.name
  } catch {
    return undefined
  }
}

/** Put a match in the room (replacing the last trial piece) and picture it. */
async function tryPiece(otto: Otto, state: State, m: Match): Promise<{ placed: Placed; picture: Reply | null }> {
  if (state.placed && !state.placed.kept) await otto.removePiece(state.placed.roomId, state.placed.name)
  const name = await otto.addPiece(state.roomId, m.id)
  let picture: Reply | null = null
  try {
    picture = { image: await otto.renderRoom(state.roomId, name), mimeType: 'image/png', name: 'your-room.png' }
  } catch {
    // the piece is in the room either way; the text says so
  }
  return { placed: { roomId: state.roomId, name, matchId: m.id, title: m.title, kept: false }, picture }
}

async function onPhoto(otto: Otto, state: State, msg: Extract<Incoming, { kind: 'photo' }>, publicUrl: string): Promise<Turn> {
  if (!msg.mimeType.startsWith('image/')) return { state, replies: [{ text: "Send a photo (JPEG, PNG or WebP) and I'll look for it." }] }
  const result = await otto.matchPhoto(await msg.read(), msg.mimeType, state.roomId)
  if (!result.matches.length) return { state: { ...state, matches: [], greeted: true }, replies: [{ text: result.message }] }

  const [best, ...others] = result.matches
  const { placed, picture } = await tryPiece(otto, state, best)
  const where = roomPhrase(await roomName(otto, state.roomId))
  const desc = result.features.description.replace(/^(a|an)\s+/i, '')
  const fit = best.fits === false ? ` Heads up: it ${(best.problems ?? ['may not fit'])[0].toLowerCase()}.` : ''
  const replies: Reply[] = [
    { text: `That looks like ${article(desc)} ${desc}. The closest I have is the ${best.title} (${money(best.price, best.currency)}, ${cm(best.size)}).${fit}` },
  ]
  if (picture) replies.push(picture)
  const lines = [
    picture ? `This is what it would look like in ${where}.` : `I put it in ${where}, but couldn't draw the room just now.`,
    `Open it in 3D: ${link3d(publicUrl, state.roomId, placed.name)}`,
  ]
  if (others.length) {
    lines.push('', 'Other options:', ...others.map((m, i) => matchLine(m, i + 2)))
    lines.push('', `Reply ${others.length === 1 ? '2' : '2 or 3'} to swap, "keep" to keep it, or "undo" to take it out.`)
  } else {
    lines.push('', 'Reply "keep" to keep it, or "undo" to take it out.')
  }
  replies.push({ text: lines.join('\n') })
  return { state: { ...state, matches: result.matches, placed, greeted: true }, replies }
}

async function onText(otto: Otto, state: State, raw: string, publicUrl: string): Promise<Turn> {
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

  if (intent.kind === 'choice') {
    const m = state.matches[intent.n - 1]
    if (state.placed?.matchId === m.id && state.placed.roomId === state.roomId) {
      return { state, replies: [{ text: `The ${m.title} is already in your room.` }] }
    }
    const { placed, picture } = await tryPiece(otto, state, m)
    const where = roomPhrase(await roomName(otto, state.roomId))
    const fit = m.fits === false ? ` Heads up: it ${(m.problems ?? ['may not fit'])[0].toLowerCase()}.` : ''
    const replies: Reply[] = []
    if (picture) replies.push(picture)
    replies.push({
      text: `${picture ? `Here's the ${m.title} (${money(m.price, m.currency)}) in ${where}.` : `I put the ${m.title} in ${where}, but couldn't draw the room just now.`}${fit}\nOpen it in 3D: ${link3d(publicUrl, state.roomId, placed.name)}`,
    })
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
