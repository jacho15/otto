// Photon 2.0 (beta) iMessage: poll for received messages, reply with text and pictures.
// Follows Photon's "Build an iMessage agent" guide: listMessages to receive, sendMessage to reply,
// with the agent's own line (receivedBy.id) as the sender. Pictures go up as attachments first.
// Unlike the guide, replies aren't threaded (no parentMessageId): shared lines don't support that.
import { setTimeout as sleep } from 'node:timers/promises'
import { ApiError, Photon } from '@photon-ai/api'
import type { Incoming } from './conversation'

export interface Outbox {
  text(text: string): Promise<void>
  image(image: Buffer, mimeType: string, name: string): Promise<void>
  typing(on: boolean): Promise<void>
}

export type Handler = (key: string, outbox: Outbox, msg: Incoming) => void

type Page = Awaited<ReturnType<Photon['projects']['listMessages']>>
type Item = Page['items'][number]

const POLL_MS = 2000

/** A two-part multipart/related body: the attachment's JSON description, then its bytes. */
export function relatedBody(bytes: Buffer, contentType: string, filename: string): { body: Buffer; contentType: string } {
  const boundary = `otto-${Math.random().toString(36).slice(2)}`
  const meta = JSON.stringify({ contentType, sizeBytes: bytes.length, filename })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/related; boundary=${boundary}; type="application/json"` }
}

/** The text or photo in a received message, or null for anything else (reactions, typing, ...). */
export async function incomingOf(
  m: Pick<Item, 'content'>,
  download: (attachmentId: string) => Promise<{ bytes: Buffer; mimeType: string }>,
): Promise<Incoming | null> {
  const c = m.content as { type: string; text?: string; attachmentId?: string; parts?: { type: string; text?: string; attachmentId?: string }[] }
  // A photo sent with a caption arrives as a group: take its first picture.
  const parts = c.type === 'group' ? (c.parts ?? []) : [c]
  const att = parts.find((p) => p.type === 'attachment' && p.attachmentId)
  if (att?.attachmentId) {
    const { bytes, mimeType } = await download(att.attachmentId)
    return { kind: 'photo', mimeType, read: async () => bytes }
  }
  const text = parts.find((p) => p.type === 'text' && typeof p.text === 'string')
  return text ? { kind: 'text', text: text.text! } : null
}

export async function runPhotonV2(cfg: { key: string; project: string; lookbackSeconds?: number }, handle: Handler): Promise<never> {
  const photon = new Photon({ headers: { Authorization: `Bearer ${cfg.key}` } })
  const project = cfg.project
  const seen = new Set<string>()
  // Look back a little at start, so a message sent while otto was restarting still gets an answer.
  let createdSince = new Date(Date.now() - (cfg.lookbackSeconds ?? 5) * 1000).toISOString()

  const download = async (attachmentId: string) => {
    const blob = await photon.projects.downloadAttachment({ path: { id: project, attachmentId } })
    return { bytes: Buffer.from(await blob.arrayBuffer()), mimeType: blob.type || 'image/jpeg' }
  }

  console.log('otto is listening on iMessage (Photon 2.0)')
  for (;;) {
    try {
      let pageToken: string | undefined
      do {
        const page = await photon.projects.listMessages({
          path: { id: project },
          query: { createdSince, direction: 'received', order: 'asc', pageSize: 100, platform: 'imessage', ...(pageToken ? { pageToken } : {}) },
        })
        for (const m of page.items) {
          if (m.platform !== 'imessage') continue // also skips messages from platforms this client doesn't know yet
          if (seen.has(m.id)) continue
          seen.add(m.id)
          if (m.createdAt > createdSince) createdSince = m.createdAt
          // as in Photon's guide: an iMessage from a person to this agent, in a known space
          if (m.status !== 'received') continue
          if (m.sentBy.platform !== 'imessage' || m.receivedBy?.platform !== 'imessage' || m.space.platform !== 'imessage') continue
          if (m.sentBy.kind !== 'human' || m.receivedBy.kind !== 'agent' || m.sentBy.id === m.receivedBy.id) continue
          const msg = await incomingOf(m, download)
          if (!msg) continue
          const spaceId = m.space.id
          const senderId = m.receivedBy.id
          let n = 0
          const send = (content: Parameters<Photon['projects']['sendMessage']>[0]['body']['content']) =>
            photon.projects
              .sendMessage({
                path: { id: project },
                headers: { 'idempotency-key': `otto:${m.id}:${n++}` },
                // plain messages, not threaded replies: shared iMessage lines refuse replies (409 SPACE_NOT_SENDABLE)
                body: { spaceId, senderId, content },
              })
              .then(() => undefined)
          const outbox: Outbox = {
            text: (text) => send({ type: 'text', format: 'plain', text }),
            async image(bytes, mimeType, name) {
              const { body, contentType } = relatedBody(bytes, mimeType, name)
              const att = await photon.projects.uploadAttachment({
                path: { id: project },
                headers: { 'content-length': String(body.length), 'content-type': contentType, 'idempotency-key': `otto:${m.id}:upload:${n}` },
                body: new Blob([new Uint8Array(body)], { type: contentType }),
              })
              await send({ type: 'attachment', attachmentId: att.id })
            },
            typing: (on) =>
              photon.projects.setSpaceTyping({ path: { id: project, spaceId }, body: { senderId, typing: on } }).then(
                () => undefined,
                () => undefined, // typing dots are a nicety; never fail a reply over them
              ),
          }
          console.log(`[imessage] ${m.sentBy.handle}: ${msg.kind === 'text' ? msg.text : `[photo ${msg.mimeType}]`}`)
          handle(`imessage:${spaceId}`, outbox, msg)
        }
        pageToken = page.nextPageToken ?? undefined
      } while (pageToken)
    } catch (e) {
      if (e instanceof ApiError) console.error(`Photon API error ${e.status} (request ${e.requestId ?? 'unknown'})`, e.message)
      else console.error(e instanceof Error ? e.message : e)
    }
    await sleep(POLL_MS)
  }
}
