import { describe, expect, it } from 'vitest'
import { combine, intentOf, matchLine, newState, respond, roomPhrase, type Match, type Otto, type Reply, type State } from './conversation'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const MP4 = Buffer.from('mp4')

const match = (id: string, title: string, price: number, extra: Partial<Match> = {}): Match => ({
  id, title, url: `https://www.ikea.com/us/en/p/${id}/`, price, currency: 'USD', size: [0.63, 0.75, 0.68], photo_url: `/api/catalog/${id}/photo`,
  why: 'Same type, similar colour and close in size', fits: true, problems: [], ...extra,
})

const MATCHES = [match('dyvlinge', 'DYVLINGE Swivel chair', 199), match('lomsk', 'PS LÖMSK Swivel armchair', 129.99), match('strandmon', 'STRANDMON Wing chair', 399)]

function fakeOtto(overrides: Partial<Otto> = {}) {
  const calls: string[] = []
  let n = 0
  const otto: Otto = {
    async matchPhoto(photo, mimeType, roomId) {
      calls.push(`match ${mimeType} ${roomId}`)
      return { features: { found: true, type: 'chair', description: 'grey plastic stacking chair with a black metal frame' }, matches: MATCHES, message: '' }
    },
    async addPiece(roomId, catalogId) {
      calls.push(`add ${roomId} ${catalogId}`)
      return `${catalogId}_${++n}`
    },
    async removePiece(roomId, name) {
      calls.push(`remove ${roomId} ${name}`)
    },
    async renderRoom(roomId, select) {
      calls.push(`render ${roomId} ${select}`)
      return PNG
    },
    async renderTour(roomId, focus) {
      calls.push(`tour ${roomId} ${focus}`)
      return MP4
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
const media = (replies: Reply[]) => replies.filter((r): r is Extract<Reply, { media: Buffer }> => 'media' in r)
const kinds = (replies: Reply[]) => replies.map((r) => ('text' in r ? 'text' : r.mimeType))

describe('intentOf: what a reply asks for, with filler words', () => {
  it.each([
    ['2', 2], ['#2', 2], ['yeah 2 pls', 2], ['show me 3', 3], ['lets try number 2', 2], ['the second one', 2], ['Third!', 3], ['ok 2', 2],
  ])('"%s" picks %i', (text, n) => expect(intentOf(text, 3)).toEqual({ kind: 'choice', n }))

  it.each([['undo'], ['nah take it out'], ['remove it please'], ['never mind'], ['get rid of that']])('"%s" is undo', (text) =>
    expect(intentOf(text, 3).kind).toBe('undo'),
  )

  it.each([['keep it'], ['I love it'], ["perfect, I'll take it"]])('"%s" is keep', (text) => expect(intentOf(text, 3).kind).toBe('keep'))

  it('reads rooms and room switches', () => {
    expect(intentOf('what rooms do I have', 3)).toEqual({ kind: 'rooms' })
    expect(intentOf('switch to room 2', 3)).toEqual({ kind: 'room', n: 2 })
  })

  it.each([['These chairs look fire.'], ['i have 2 kids and a dog'], ['4'], ['lol']])('"%s" is just chat', (text) =>
    expect(intentOf(text, 3).kind).toBe('chat'),
  )

  it('never reads a choice when there is nothing to choose from', () => expect(intentOf('2', 0).kind).toBe('chat'))
})

describe('combine: messages sent together are one thought', () => {
  it('a photo wins, and its text is just a comment', () => expect(combine([say('These chairs look fire.'), photo], 0)).toBe(photo))
  it('the last text that asks for something wins over chat', () => {
    const pick = say('2')
    expect(combine([say('hmm'), pick, say('looks nice')], 3)).toBe(pick)
  })
  it('otherwise the last text', () => {
    const last = say('ok')
    expect(combine([say('hi'), last], 0)).toBe(last)
  })
  it('nothing in, nothing out', () => expect(combine([], 0)).toBeNull())
})

describe('wording', () => {
  it('lists an option with price and size, and why it will not fit', () => {
    expect(matchLine(MATCHES[1], 2)).toBe('2. PS LÖMSK Swivel armchair: $129.99 · 63 × 75 × 68 cm\nBuy it: https://www.ikea.com/us/en/p/lomsk/')
    expect(matchLine(match('x', 'Big', 10, { fits: false, problems: ['Taller than the ceiling'] }), 3)).toContain("won't fit: taller than the ceiling")
  })
  it('names the room the way a person would', () => {
    expect(roomPhrase('Demo Living Room')).toBe('your living room')
    expect(roomPhrase('Loft')).toBe('your loft')
    expect(roomPhrase(undefined)).toBe('your room')
  })
})

describe('a conversation', () => {
  it('answers a photo with the match, its photo, the room picture and video, and the other options with photos', async () => {
    const { otto, calls } = fakeOtto()
    const turn = await respond(otto, newState('demo-living-room'), photo)
    expect(calls.slice(0, 2)).toEqual(['match image/jpeg demo-living-room', 'add demo-living-room dyvlinge'])
    expect(calls).toEqual(expect.arrayContaining(['render demo-living-room dyvlinge_1', 'tour demo-living-room dyvlinge_1']))
    expect(kinds(turn.replies)).toEqual([
      'text', 'image/jpeg', // the match and its photo
      'text', 'image/png', 'video/mp4', // in your room: picture, then the walk-around
      'text', 'text', 'image/jpeg', 'text', 'image/jpeg', // other options, each with its photo
      'text', // what to reply
    ])
    const t = texts(turn.replies)
    expect(t[0]).toBe(
      'That looks like a grey plastic stacking chair with a black metal frame. The closest I have is the DYVLINGE Swivel chair: $199.00 · 63 × 75 × 68 cm.\nBuy it: https://www.ikea.com/us/en/p/dyvlinge/',
    )
    expect(t[1]).toBe('This is what it would look like in your living room:')
    expect(t[3]).toBe('2. PS LÖMSK Swivel armchair: $129.99 · 63 × 75 × 68 cm\nBuy it: https://www.ikea.com/us/en/p/lomsk/')
    expect(t.at(-1)).toBe('Reply 2 or 3 to swap, "keep" to keep it, or "undo" to take it out.')
    expect(t.join('\n')).not.toMatch(/rooms\/|select=/) // no links to the website, only shop links
    expect(turn.state.placed).toMatchObject({ name: 'dyvlinge_1', matchId: 'dyvlinge', kept: false })
  })

  it('skips any photo or video it cannot get, and still answers', async () => {
    const { otto } = fakeOtto({ fetchFile: async () => { throw new Error('404') }, renderTour: async () => { throw new Error('slow') } })
    const turn = await respond(otto, newState('demo-living-room'), photo)
    expect(kinds(turn.replies).filter((k) => k !== 'text')).toEqual(['image/png'])
  })

  it('swaps in another option, taking the trial piece out first', async () => {
    const { otto, calls } = fakeOtto()
    const a = await respond(otto, newState('demo-living-room'), photo)
    const b = await respond(otto, a.state, say('yeah 2 pls'))
    expect(calls.slice(-4, -2)).toEqual(['remove demo-living-room dyvlinge_1', 'add demo-living-room lomsk'])
    expect(kinds(b.replies)).toEqual(['text', 'image/png', 'video/mp4'])
    expect(texts(b.replies)[0]).toBe("Here's the PS LÖMSK Swivel armchair ($129.99) in your living room.")
    expect(b.state.placed?.name).toBe('lomsk_2')
  })

  it('does nothing when you pick the piece that is already there', async () => {
    const { otto, calls } = fakeOtto()
    const a = await respond(otto, newState('r'), photo)
    const before = calls.length
    const b = await respond(otto, a.state, say('1'))
    expect(calls.length).toBe(before)
    expect(texts(b.replies)[0]).toBe('The DYVLINGE Swivel chair is already in your room.')
  })

  it('keeps a piece, so the next photo adds to the room instead of replacing it', async () => {
    const { otto, calls } = fakeOtto()
    const a = await respond(otto, newState('r'), photo)
    const b = await respond(otto, a.state, say('keep it'))
    expect(texts(b.replies)[0]).toBe('Kept the DYVLINGE Swivel chair in your room. Send another photo to keep going.')
    await respond(otto, b.state, photo)
    expect(calls.filter((c) => c.startsWith('remove'))).toEqual([])
  })

  it('replaces an unkept trial piece when a new photo comes in', async () => {
    const { otto, calls } = fakeOtto()
    const a = await respond(otto, newState('r'), photo)
    await respond(otto, a.state, photo)
    expect(calls.filter((c) => c.startsWith('remove'))).toEqual(['remove r dyvlinge_1'])
  })

  it('undoes, once', async () => {
    const { otto, calls } = fakeOtto()
    const a = await respond(otto, newState('r'), photo)
    const b = await respond(otto, a.state, say('nah take it out'))
    expect(calls.at(-1)).toBe('remove r dyvlinge_1')
    expect(texts(b.replies)).toEqual(['Took the DYVLINGE Swivel chair back out.'])
    const c = await respond(otto, b.state, say('undo'))
    expect(texts(c.replies)).toEqual(["There's nothing to undo yet."])
  })

  it('still places the piece when the room cannot be drawn, and says so', async () => {
    const { otto } = fakeOtto({ renderRoom: async () => { throw new Error('website down') }, renderTour: async () => { throw new Error('website down') } })
    const turn = await respond(otto, newState('demo-living-room'), photo)
    expect(kinds(turn.replies)).not.toContain('image/png')
    expect(texts(turn.replies)).toContain("I put it in your living room, but couldn't draw the room just now.")
    expect(turn.state.placed?.name).toBe('dyvlinge_1')
  })

  it('warns when the best match does not fit', async () => {
    const tight = [match('big', 'Huge sofa', 900, { fits: false, problems: ['Overlaps KLIPPAN Loveseat'] })]
    const { otto } = fakeOtto({ matchPhoto: async () => ({ features: { found: true, type: 'sofa', description: 'a big sofa' }, matches: tight, message: '' }) })
    const turn = await respond(otto, newState('r'), photo)
    expect(texts(turn.replies)[0]).toContain('That looks like a big sofa.')
    expect(texts(turn.replies)[0]).toContain('Heads up: it overlaps klippan loveseat.')
    expect(texts(turn.replies).at(-1)).toContain('Reply "keep" to keep it, or "undo" to take it out.')
  })

  it('lists rooms and switches between them', async () => {
    const { otto } = fakeOtto()
    const list = await respond(otto, newState('demo-living-room'), say('rooms'))
    expect(texts(list.replies)[0]).toBe('Your rooms:\n1. Demo Living Room (current)\n2. Loft\nReply "room 2" to switch.')
    const switched = await respond(otto, list.state, say('room 2'))
    expect(switched.state.roomId).toBe('loft')
  })

  it('answers chat with a short nudge, and the long help only once', async () => {
    const { otto } = fakeOtto()
    const hi = await respond(otto, newState('r'), say('hi'))
    expect(texts(hi.replies)[0]).toContain('Send me a photo of a piece of furniture you like')
    const again = await respond(otto, hi.state, say('These chairs look fire.'))
    expect(texts(again.replies)).toEqual(["Send me a photo whenever you're ready."])
    const a = await respond(otto, again.state, photo)
    const chat = await respond(otto, a.state, say('lol nice'))
    expect(texts(chat.replies)).toEqual(['Reply 2 or 3 to swap it, "keep" to keep it, or send another photo.'])
  })

  it('passes on what the photo search said when nothing matched', async () => {
    const { otto } = fakeOtto({ matchPhoto: async () => ({ features: { found: false, type: 'other', description: '' }, matches: [], message: "I couldn't spot a piece of furniture in that photo." }) })
    const turn = await respond(otto, newState('r'), photo)
    expect(texts(turn.replies)).toEqual(["I couldn't spot a piece of furniture in that photo."])
  })

  it('turns an API failure into a plain message instead of crashing', async () => {
    const { otto } = fakeOtto({ matchPhoto: async () => { throw new Error('Add ANTHROPIC_API_KEY to .env') } })
    const state: State = newState('r')
    const turn = await respond(otto, state, photo)
    expect(turn.state).toBe(state)
    expect(texts(turn.replies)).toEqual(['Something went wrong: Add ANTHROPIC_API_KEY to .env'])
  })
})
