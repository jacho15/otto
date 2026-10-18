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
    async matchPhoto(photo, mimeType, roomId, note) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(photo)], { type: mimeType }), 'photo')
      form.append('room_id', roomId)
      form.append('live', 'true') // search IKEA too, so it isn't limited to otto's own catalog
      if (note) form.append('note', note.slice(0, 500))
      const res = await check(await fetch(url('/api/match-photo'), { method: 'POST', body: form }))
      return (await res.json()) as MatchResult
    },

    async addPiece(roomId, match) {
      let catalogId = match.id
      if (match.source === 'ikea') {
        // a live IKEA find isn't in the catalog: save it as a custom item first, drawn in the photo's colour
        const made = await check(
          await fetch(url('/api/custom-items'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: match.title.slice(0, 120), url: match.url, price: match.price, currency: match.currency,
              size: match.size, label: match.label, image_url: match.image_url ?? undefined, rgba: match.rgba ?? undefined,
            }),
          }),
        )
        catalogId = ((await made.json()) as { id: string }).id
      }
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

    async renderTour(roomId, focus) {
      const res = await check(await fetch(url(`${room(roomId)}/tour.mp4?focus=${encodeURIComponent(focus)}`)))
      return Buffer.from(await res.arrayBuffer())
    },

    async fetchFile(path) {
      // otto's own files by path; product photos on IKEA by full address
      const res = await check(await fetch(/^https?:\/\//.test(path) ? path : url(path)))
      return Buffer.from(await res.arrayBuffer())
    },

    async listRooms() {
      const res = await check(await fetch(url('/api/rooms')))
      return ((await res.json()) as RoomSummary[]).map(({ id, name }) => ({ id, name }))
    },
  }
}
