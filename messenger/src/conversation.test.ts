import { describe, expect, it } from 'vitest'
import { imageMime, matchLine, newState, parseChoice, respond, type Match, type Otto, type Reply, type State } from './conversation'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const URL_BASE = 'https://otto.example'

const match = (id: string, title: string, price: number, extra: Partial<Match> = {}): Match => ({
  id, title, price, currency: 'USD', size: [0.8, 0.85, 1.0], photo_url: `/api/catalog/files/photos/${id}.jpg`,
  why: 'Same type, similar colour and close in size', fits: true, problems: [], ...extra,
})

const MATCHES = [match('poang', 'POÄNG Armchair', 149), match('lomsk', 'PS LÖMSK Swivel armchair', 129.99), match('strandmon', 'STRANDMON Wing chair', 399)]

function fakeOtto(overrides: Partial<Otto> = {}) {
  const calls: string[] = []
  const otto: Otto = {
    async matchPhoto(photo, mimeType, roomId) {
      calls.push(`match ${mimeType} ${roomId} ${photo.length}`)
      return { features: { found: true, type: 'armchair', description: 'white leather armchair' }, matches: MATCHES, message: 'Here are the 3 closest pieces.' }
    },
    async addPiece(roomId, catalogId) {
      calls.push(`add ${roomId} ${catalogId}`)
      return `${catalogId}_2`
    },
    async removePiece(roomId, name) {
      calls.push(`remove ${roomId} ${name}`)
    },
    async renderRoom(roomId, select) {
      calls.push(`render ${roomId} ${select}`)
      return PNG
    },
    async fetchFile(url) {
      calls.push(`file ${url}`)
      return JPEG
    },
    async listRooms() {
      return [{ id: 'demo-living-room', name: 'Demo Living Room' }, { id: 'loft', name: 'Loft' }]
    },
    ...overrides,
  }
  return { otto, calls }
}

const photo = { kind: 'photo' as const, read: async () => JPEG, mimeType: 'image/jpeg' }
const say = (text: string) => ({ kind: 'text' as const, text })
const texts = (replies: Reply[]) => replies.filter((r): r is { text: string } => 'text' in r).map((r) => r.text)
const images = (replies: Reply[]) => replies.filter((r) => 'image' in r) as { image: Buffer; mimeType: string; name: string }[]

describe('parseChoice', () => {
  it.each([['2', 2], ['#2', 2], ['number 3', 3], ['  1 ', 1], ['show me 2', 2], ['the second one', 2], ['Third', 3]])('reads %s', (text, n) =>
    expect(parseChoice(text, 3)).toBe(n),
  )
  it('ignores numbers out of range and plain chat', () => {
    expect(parseChoice('4', 3)).toBeNull()
    expect(parseChoice('2', 0)).toBeNull()
    expect(parseChoice('looks nice', 3)).toBeNull()
    expect(parseChoice('i have 2 kids', 3)).toBeNull()
  })
})

describe('matchLine', () => {
  it('shows price, size and fit', () => expect(matchLine(MATCHES[0], 1)).toBe('1. POÄNG Armchair: $149.00 · 80 × 85 × 100 cm · fits your room'))
  it('says why it will not fit', () =>
    expect(matchLine(match('x', 'Big', 10, { fits: false, problems: ['Taller than the ceiling'] }), 2)).toContain("won't fit: taller than the ceiling"))
})

describe('imageMime', () => {
  it('tells PNG from JPEG', () => {
    expect(imageMime(PNG)).toBe('image/png')
    expect(imageMime(JPEG)).toBe('image/jpeg')
  })
})

describe('a conversation', () => {
  it('answers a photo with the matches, their pictures and a question', async () => {
    const { otto, calls } = fakeOtto()
    const turn = await respond(otto, newState('demo-living-room'), photo, URL_BASE)
    expect(calls[0]).toBe(`match image/jpeg demo-living-room ${JPEG.length}`)
    const t = texts(turn.replies)
    expect(t[0]).toBe('That looks like a white leather armchair. The closest pieces I have:')
    expect(t.some((x) => x.startsWith('2. PS LÖMSK Swivel armchair: $129.99'))).toBe(true)
    expect(t.at(-1)).toBe('Want to see one in your room? Reply 1, 2 or 3.')
    expect(images(turn.replies)).toHaveLength(3)
    expect(turn.state.matches).toHaveLength(3)
  })

  it('skips the picture of a piece that has no photo', async () => {
    const noPhoto = [match('a', 'With photo', 10), match('b', 'No photo', 20, { photo_url: null })]
    const { otto, calls } = fakeOtto({ matchPhoto: async () => ({ features: { found: true, type: 'armchair', description: 'chair' }, matches: noPhoto, message: '' }) })
    const turn = await respond(otto, newState('r'), photo, URL_BASE)
    expect(images(turn.replies)).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith('file'))).toEqual(['file /api/catalog/files/photos/a.jpg'])
  })

  it('places the chosen piece and sends a picture of the room with a 3D link', async () => {
    const { otto, calls } = fakeOtto()
    const first = await respond(otto, newState('demo-living-room'), photo, URL_BASE)
    const turn = await respond(otto, first.state, say('2'), URL_BASE)
    expect(calls.slice(-2)).toEqual(['add demo-living-room lomsk', 'render demo-living-room lomsk_2'])
    expect(images(turn.replies)[0].mimeType).toBe('image/png')
    const last = texts(turn.replies).at(-1)!
    expect(last).toContain("Here's the PS LÖMSK Swivel armchair in your room.")
    expect(last).toContain('https://otto.example/rooms/demo-living-room?select=lomsk_2')
    expect(turn.state.placed).toEqual({ roomId: 'demo-living-room', name: 'lomsk_2', title: 'PS LÖMSK Swivel armchair' })
  })

  it('still places the piece when the picture fails', async () => {
    const { otto } = fakeOtto({ renderRoom: async () => { throw new Error('website down') } })
    const first = await respond(otto, newState('r'), photo, URL_BASE)
    const turn = await respond(otto, first.state, say('1'), URL_BASE)
    expect(images(turn.replies)).toHaveLength(0)
    expect(texts(turn.replies)[0]).toContain("couldn't draw the room")
    expect(turn.state.placed?.name).toBe('poang_2')
  })

  it('warns when the chosen piece does not fit', async () => {
    const tight = [match('big', 'Huge sofa', 900, { fits: false, problems: ['Overlaps KLIPPAN Loveseat'] })]
    const { otto } = fakeOtto({ matchPhoto: async () => ({ features: { found: true, type: 'sofa', description: 'sofa' }, matches: tight, message: '' }) })
    const first = await respond(otto, newState('r'), photo, URL_BASE)
    expect(texts(first.replies).at(-1)).toBe('Want to see one in your room? Reply 1.')
    const turn = await respond(otto, first.state, say('1'), URL_BASE)
    expect(texts(turn.replies).at(-1)).toContain('Heads up: it overlaps klippan loveseat.')
  })

  it('undoes the last piece, once', async () => {
    const { otto, calls } = fakeOtto()
    const a = await respond(otto, newState('r'), photo, URL_BASE)
    const b = await respond(otto, a.state, say('3'), URL_BASE)
    const c = await respond(otto, b.state, say('undo'), URL_BASE)
    expect(calls.at(-1)).toBe('remove r strandmon_2')
    expect(texts(c.replies)).toEqual(['Took the STRANDMON Wing chair back out.'])
    const d = await respond(otto, c.state, say('undo'), URL_BASE)
    expect(texts(d.replies)).toEqual(["There's nothing to undo yet."])
  })

  it('lists rooms and switches between them', async () => {
    const { otto } = fakeOtto()
    const list = await respond(otto, newState('demo-living-room'), say('rooms'), URL_BASE)
    expect(texts(list.replies)[0]).toBe('Your rooms:\n1. Demo Living Room (current)\n2. Loft\nReply "room 2" to switch.')
    const switched = await respond(otto, list.state, say('room 2'), URL_BASE)
    expect(switched.state.roomId).toBe('loft')
    const missing = await respond(otto, switched.state, say('room 9'), URL_BASE)
    expect(texts(missing.replies)[0]).toContain("There's no room 9")
  })

  it('passes on what the photo search said when nothing matched', async () => {
    const { otto } = fakeOtto({ matchPhoto: async () => ({ features: { found: false, type: 'other', description: '' }, matches: [], message: "I couldn't spot a piece of furniture in that photo." }) })
    const turn = await respond(otto, newState('r'), photo, URL_BASE)
    expect(texts(turn.replies)).toEqual(["I couldn't spot a piece of furniture in that photo."])
  })

  it('asks for a photo when an attachment is not an image', async () => {
    const { otto, calls } = fakeOtto()
    const turn = await respond(otto, newState('r'), { kind: 'photo', read: async () => JPEG, mimeType: 'application/pdf' }, URL_BASE)
    expect(texts(turn.replies)[0]).toContain('Send a photo')
    expect(calls).toEqual([])
  })

  it('explains itself for anything else, and nudges a bad number', async () => {
    const { otto } = fakeOtto()
    const hello = await respond(otto, newState('r'), say('hi'), URL_BASE)
    expect(texts(hello.replies)[0]).toContain('Send me a photo')
    const a = await respond(otto, newState('r'), photo, URL_BASE)
    const bad = await respond(otto, a.state, say('7'), URL_BASE)
    expect(texts(bad.replies)).toEqual(['Pick a number from 1 to 3.'])
  })

  it('turns an API failure into a plain message instead of crashing', async () => {
    const { otto } = fakeOtto({ matchPhoto: async () => { throw new Error('Add ANTHROPIC_API_KEY to .env') } })
    const state: State = newState('r')
    const turn = await respond(otto, state, photo, URL_BASE)
    expect(turn.state).toBe(state)
    expect(texts(turn.replies)).toEqual(['Something went wrong: Add ANTHROPIC_API_KEY to .env'])
  })
})
