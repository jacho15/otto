// What otto says back in a text conversation. No Spectrum and no network here: otto's API is passed in,
// and replies are plain values, so the whole flow can be tested.
//
// Send a photo  -> the closest pieces, each with its picture, then "Reply 1, 2 or 3".
// Reply a number -> that piece goes into your room, and you get a picture of the room with it.
// "undo"         -> takes it back out. "rooms" / "room 2" -> choose which room to try things in.

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
  fetchFile(url: string): Promise<Buffer>
  listRooms(): Promise<RoomSummary[]>
}

export type Reply = { text: string } | { image: Buffer; mimeType: string; name: string }

export interface State {
  roomId: string
  matches: Match[]
  placed: { roomId: string; name: string; title: string } | null
}

export type Incoming = { kind: 'text'; text: string } | { kind: 'photo'; read: () => Promise<Buffer>; mimeType: string }

export const newState = (roomId: string): State => ({ roomId, matches: [], placed: null })

const WORDS: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3 }

/** 1-based choice from replies like "2", "#2", "number 2", "the second one". Null if there is none. */
export function parseChoice(text: string, count: number): number | null {
  const t = text.trim().toLowerCase()
  const digit = t.match(/^(?:#|no\.?\s*|number\s*|option\s*|show\s*(?:me\s*)?)?([1-9])\b/)
  // "the second one": the earliest number word wins, so "second" beats the trailing "one"
  const words = Object.entries(WORDS)
    .map(([w, v]) => ({ at: t.search(new RegExp(`\\b${w}\\b`)), v }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
  const n = digit ? Number(digit[1]) : words[0]?.v
  return n && n >= 1 && n <= count ? n : null
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

/** The image type from a file's first bytes, so a catalog PNG isn't sent as a JPEG. */
export function imageMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}

const cm = (size: [number, number, number]) => size.map((v) => Math.round(v * 100)).join(' × ') + ' cm'

export function matchLine(m: Match, n: number): string {
  const fit = m.fits === undefined ? '' : m.fits ? ' · fits your room' : ` · won't fit: ${(m.problems ?? [])[0]?.toLowerCase() ?? 'no space'}`
  return `${n}. ${m.title}: ${money(m.price, m.currency)} · ${cm(m.size)}${fit}`
}

const HELP = 'Send me a photo of a piece of furniture you like, and I\'ll find the closest ones and show them in your room.'

export interface Turn {
  state: State
  replies: Reply[]
}

/** One incoming message in, the new state and what to send back out. `publicUrl` is where the website lives. */
export async function respond(otto: Otto, state: State, msg: Incoming, publicUrl: string): Promise<Turn> {
  try {
    if (msg.kind === 'photo') return await onPhoto(otto, state, msg)
    return await onText(otto, state, msg.text, publicUrl)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { state, replies: [{ text: `Something went wrong: ${reason}` }] }
  }
}

async function onPhoto(otto: Otto, state: State, msg: Extract<Incoming, { kind: 'photo' }>): Promise<Turn> {
  if (!msg.mimeType.startsWith('image/')) return { state, replies: [{ text: 'Send a photo (JPEG, PNG or WebP) and I\'ll look for it.' }] }
  const result = await otto.matchPhoto(await msg.read(), msg.mimeType, state.roomId)
  if (!result.matches.length) return { state: { ...state, matches: [] }, replies: [{ text: result.message }] }
  const replies: Reply[] = [{ text: `That looks like a ${result.features.description}. The closest pieces I have:` }]
  for (const [i, m] of result.matches.entries()) {
    replies.push({ text: `${matchLine(m, i + 1)}\n${m.why}.` })
    if (!m.photo_url) continue
    try {
      const photo = await otto.fetchFile(m.photo_url)
      const mimeType = imageMime(photo)
      replies.push({ image: photo, mimeType, name: `${m.id}.${mimeType.split('/')[1]}` })
    } catch {
      // a missing product photo shouldn't stop the reply
    }
  }
  const choices = result.matches.length === 1 ? '1' : result.matches.length === 2 ? '1 or 2' : '1, 2 or 3'
  replies.push({ text: `Want to see one in your room? Reply ${choices}.` })
  return { state: { ...state, matches: result.matches }, replies }
}

async function onText(otto: Otto, state: State, raw: string, publicUrl: string): Promise<Turn> {
  const text = raw.trim().toLowerCase()

  if (text === 'undo' || text === 'take it out' || text === 'remove it') {
    if (!state.placed) return { state, replies: [{ text: 'There\'s nothing to undo yet.' }] }
    await otto.removePiece(state.placed.roomId, state.placed.name)
    return { state: { ...state, placed: null }, replies: [{ text: `Took the ${state.placed.title} back out.` }] }
  }

  if (text === 'rooms') {
    const rooms = await otto.listRooms()
    const list = rooms.map((r, i) => `${i + 1}. ${r.name}${r.id === state.roomId ? ' (current)' : ''}`).join('\n')
    return { state, replies: [{ text: `Your rooms:\n${list}\nReply "room 2" to switch.` }] }
  }

  const roomPick = text.match(/^room\s+(\d+)$/)
  if (roomPick) {
    const rooms = await otto.listRooms()
    const room = rooms[Number(roomPick[1]) - 1]
    if (!room) return { state, replies: [{ text: `There's no room ${roomPick[1]}. Reply "rooms" to see them.` }] }
    return { state: { ...state, roomId: room.id, matches: [] }, replies: [{ text: `Now trying things in ${room.name}. Send a photo.` }] }
  }

  const choice = parseChoice(text, state.matches.length)
  if (choice) {
    const m = state.matches[choice - 1]
    const name = await otto.addPiece(state.roomId, m.id)
    const replies: Reply[] = []
    try {
      replies.push({ image: await otto.renderRoom(state.roomId, name), mimeType: 'image/png', name: 'your-room.png' })
    } catch {
      replies.push({ text: 'I couldn\'t draw the room just now, but the piece is in it.' })
    }
    const link = `${publicUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(state.roomId)}?select=${encodeURIComponent(name)}`
    const fit = m.fits === false ? ` Heads up: it ${(m.problems ?? ['may not fit'])[0].toLowerCase()}.` : ''
    replies.push({ text: `Here's the ${m.title} in your room.${fit}\nOpen it in 3D: ${link}\nReply "undo" to take it out, or send another photo.` })
    return { state: { ...state, placed: { roomId: state.roomId, name, title: m.title } }, replies }
  }

  if (state.matches.length && /^\d+$/.test(text)) {
    return { state, replies: [{ text: `Pick a number from 1 to ${state.matches.length}.` }] }
  }
  return { state, replies: [{ text: HELP }] }
}
