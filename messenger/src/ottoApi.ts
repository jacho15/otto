// otto's HTTP API, as the conversation needs it.
import type { MatchResult, Otto, RoomSummary } from './conversation'

async function check(res: Response): Promise<Response> {
  if (res.ok) return res
  let detail = `${res.status} ${res.statusText}`
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
  } catch {
    // not JSON: keep the status line
  }
  throw new Error(detail)
}

export function ottoApi(base: string): Otto {
  const url = (path: string) => `${base.replace(/\/$/, '')}${path}`
  const room = (id: string) => `/api/rooms/${encodeURIComponent(id)}`

  return {
    async matchPhoto(photo, mimeType, roomId) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(photo)], { type: mimeType }), 'photo')
      form.append('room_id', roomId)
      const res = await check(await fetch(url('/api/match-photo'), { method: 'POST', body: form }))
      return (await res.json()) as MatchResult
    },

    async addPiece(roomId, catalogId) {
      const res = await check(
        await fetch(url(`${room(roomId)}/objects`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ catalog_id: catalogId }),
        }),
      )
      return ((await res.json()) as { added: string }).added
    },

    async removePiece(roomId, name) {
      await check(await fetch(url(`${room(roomId)}/objects/${encodeURIComponent(name)}`), { method: 'DELETE' }))
    },

    async renderRoom(roomId, select) {
      const res = await check(await fetch(url(`${room(roomId)}/render.png?select=${encodeURIComponent(select)}`)))
      return Buffer.from(await res.arrayBuffer())
    },

    async fetchFile(path) {
      const res = await check(await fetch(url(path)))
      return Buffer.from(await res.arrayBuffer())
    },

    async listRooms() {
      const res = await check(await fetch(url('/api/rooms')))
      return ((await res.json()) as RoomSummary[]).map(({ id, name }) => ({ id, name }))
    },
  }
}
