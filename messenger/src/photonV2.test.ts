import { describe, expect, it } from 'vitest'
import { incomingOf, relatedBody } from './photonV2'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

describe('relatedBody', () => {
  it('is two parts: the JSON description, then the bytes', () => {
    const { body, contentType } = relatedBody(PNG, 'image/png', 'room.png')
    const boundary = contentType.match(/boundary=([^;]+)/)![1]
    expect(contentType).toBe(`multipart/related; boundary=${boundary}; type="application/json"`)
    const text = body.toString('latin1')
    const parts = text.split(`--${boundary}`)
    expect(parts).toHaveLength(4) // preamble, json, file, closing "--"
    expect(parts[1]).toContain('Content-Type: application/json')
    expect(JSON.parse(parts[1].split('\r\n\r\n')[1].trim())).toEqual({ contentType: 'image/png', sizeBytes: PNG.length, filename: 'room.png' })
    expect(parts[2]).toContain('Content-Type: image/png')
    expect(body.includes(PNG)).toBe(true)
    expect(parts[3].startsWith('--')).toBe(true)
  })
})

describe('incomingOf', () => {
  const download = async (id: string) => ({ bytes: Buffer.from(id), mimeType: 'image/heic' })

  it('reads plain text', async () => {
    expect(await incomingOf({ content: { type: 'text', format: 'plain', text: 'undo' } } as never, download)).toEqual({ kind: 'text', text: 'undo' })
  })

  it('downloads a photo and keeps its real type', async () => {
    const msg = await incomingOf({ content: { type: 'attachment', attachmentId: 'pho_att_1' } } as never, download)
    expect(msg?.kind).toBe('photo')
    if (msg?.kind !== 'photo') return
    expect(msg.mimeType).toBe('image/heic')
    expect((await msg.read()).toString()).toBe('pho_att_1')
  })

  it('takes the picture from a photo sent with a caption', async () => {
    const group = { type: 'group', parts: [{ type: 'text', format: 'plain', text: 'this one?' }, { type: 'attachment', attachmentId: 'pho_att_2' }] }
    const msg = await incomingOf({ content: group } as never, download)
    expect(msg?.kind).toBe('photo')
  })

  it('ignores reactions, typing and the like', async () => {
    expect(await incomingOf({ content: { type: 'reaction', reaction: 'love' } } as never, download)).toBeNull()
  })
})
