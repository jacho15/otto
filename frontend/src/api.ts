import type {
  AddResult,
  CatalogItem,
  DesignResult,
  Mandate,
  MandateInput,
  NewRoomInput,
  Order,
  Room,
  RoomSummary,
  SavedItem,
  Vec2,
} from './types'

/** A failed response. `detail` is the server's `detail` field (a string or {violations}), if it sent one. */
export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(`Server error ${status}.`)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error('Cannot reach the Otto server.')
  }
  if (!res.ok) {
    const detail = await res.json().then((b: { detail?: unknown }) => b?.detail, () => undefined)
    // The dev proxy answers 502-504 when the backend is down. A string detail means the server itself answered.
    if (res.status >= 502 && res.status <= 504 && typeof detail !== 'string') throw new Error('Cannot reach the Otto server.')
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export const listRooms = () => request<RoomSummary[]>('/api/rooms')

export const getRoom = (id: string) => request<Room>(`/api/rooms/${encodeURIComponent(id)}`)

const objectUrl = (id: string, name: string) =>
  `/api/rooms/${encodeURIComponent(id)}/objects/${encodeURIComponent(name)}`

export const patchObject = (id: string, name: string, body: { pos?: Vec2; yaw?: number }) =>
  request<Room>(objectUrl(id, name), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const deleteObject = (id: string, name: string) =>
  request<Room>(objectUrl(id, name), { method: 'DELETE' })

export const getCatalog = () => request<CatalogItem[]>('/api/catalog')

export const addObject = (id: string, catalogId: string, replace?: string) =>
  request<AddResult>(`/api/rooms/${encodeURIComponent(id)}/objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalog_id: catalogId, replace: replace ?? null }),
  })

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const getMandate = () => request<Mandate | null>('/api/mandate')

export const putMandate = (m: MandateInput) => request<Mandate>('/api/mandate', { method: 'PUT', ...json(m) })

export const deleteMandate = () => request<null>('/api/mandate', { method: 'DELETE' })

const orderUrl = (id: string) => `/api/rooms/${encodeURIComponent(id)}/orders`

export const listOrders = (id: string) => request<Order[]>(orderUrl(id))

export const agentCheckout = (id: string, instruction: string) =>
  request<{ message: string; order: Order | null }>(`/api/rooms/${encodeURIComponent(id)}/agent/checkout`, {
    method: 'POST',
    ...json({ instruction }),
  })

export const approveOrder = (id: string, oid: string) =>
  request<Order>(`${orderUrl(id)}/${encodeURIComponent(oid)}/approve`, { method: 'POST' })

export const cancelOrder = (id: string, oid: string) =>
  request<Order>(`${orderUrl(id)}/${encodeURIComponent(oid)}/cancel`, { method: 'POST' })

export const createRoom = (input: NewRoomInput) => request<Room>('/api/rooms', { method: 'POST', ...json(input) })

/** Set a room's measured size in metres; furniture stays where it is. */
export const setRoomSize = (id: string, size: { width: number; depth: number; height: number }) =>
  request<Room>(`/api/rooms/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(size) })

export const listSaved = () => request<SavedItem[]>('/api/saved')

export const saveItem = (catalogId: string, note?: string) =>
  request<SavedItem[]>('/api/saved', { method: 'POST', ...json({ catalog_id: catalogId, note: note || undefined }) })

export const unsaveItem = (catalogId: string) =>
  request<SavedItem[]>(`/api/saved/${encodeURIComponent(catalogId)}`, { method: 'DELETE' })

export const agentDesign = (id: string, instruction: string) =>
  request<DesignResult>(`/api/rooms/${encodeURIComponent(id)}/agent/design`, {
    method: 'POST',
    ...json({ instruction }),
  })

export const catalogFileUrl = (path: string) => `/api/catalog/files/${path.split('/').map(encodeURIComponent).join('/')}`

export const meshUrl = (id: string, mesh: string) => `/files/${encodeURIComponent(id)}/${mesh.split('/').map(encodeURIComponent).join('/')}`

export function formatPrice(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
