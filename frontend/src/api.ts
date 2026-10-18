import type {
  AddResult,
  AlternativesResult,
  CatalogItem,
  CustomItem,
  DesignResult,
  Layout,
  LinkDraft,
  Mandate,
  MandateInput,
  NewCustomItem,
  NewRoomInput,
  Order,
  Room,
  RoomSummary,
  SavedItem,
  SuggestResult,
  UploadResult,
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

export const getAlternatives = (id: string, name: string) =>
  request<AlternativesResult>(`${objectUrl(id, name)}/alternatives`)

export const deleteObject = (id: string, name: string) =>
  request<Room>(objectUrl(id, name), { method: 'DELETE' })

export const getCatalog = () => request<CatalogItem[]>('/api/catalog')

/** `at` places the piece exactly there; the server answers 409 if the spot is taken. */
export const addObject = (id: string, catalogId: string, replace?: string, at?: { pos: Vec2; yaw: number }) =>
  request<AddResult>(`/api/rooms/${encodeURIComponent(id)}/objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalog_id: catalogId, replace: replace ?? null, ...at }),
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

/** Undo the last change of any kind; the server answers 409 when there is nothing to undo. */
export const undoRoom = (id: string) => request<Room>(`/api/rooms/${encodeURIComponent(id)}/undo`, { method: 'POST' })

const layoutsUrl = (id: string) => `/api/rooms/${encodeURIComponent(id)}/layouts`

export const listLayouts = (id: string) => request<Layout[]>(layoutsUrl(id))

export const saveLayout = (id: string, name: string) =>
  request<Layout[]>(layoutsUrl(id), { method: 'POST', ...json({ name }) })

export const restoreLayout = (id: string, lid: string) =>
  request<Room>(`${layoutsUrl(id)}/${encodeURIComponent(lid)}/restore`, { method: 'POST' })

export const deleteLayout = (id: string, lid: string) =>
  request<Layout[]>(`${layoutsUrl(id)}/${encodeURIComponent(lid)}`, { method: 'DELETE' })

/** Set the room's doorway in metres. */
export const setDoor = (id: string, door: { width: number; height: number }) =>
  request<Room>(`/api/rooms/${encodeURIComponent(id)}/door`, { method: 'PATCH', ...json(door) })

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

export const agentSuggest = (id: string, instruction: string) =>
  request<SuggestResult>(`/api/rooms/${encodeURIComponent(id)}/agent/suggest`, {
    method: 'POST',
    ...json({ instruction }),
  })

/** Read a product page. The server answers 400 (blocked or bad link), 502 (page unreadable) or 422 (nothing found). */
export const importLink = (url: string) => request<LinkDraft>('/api/import/link', { method: 'POST', ...json({ url }) })

/** Upload a photo (JPEG, PNG or WebP, up to 5 MB) or a .glb model (up to 25 MB). */
export const uploadFile = (file: File) => {
  const body = new FormData()
  body.append('file', file)
  return request<UploadResult>('/api/uploads', { method: 'POST', body })
}

export const listCustomItems = () => request<CustomItem[]>('/api/custom-items')

export const createCustomItem = (item: NewCustomItem) =>
  request<CustomItem>('/api/custom-items', { method: 'POST', ...json(item) })

export const deleteCustomItem = (id: string) =>
  request<CustomItem[]>(`/api/custom-items/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** A path the server already made absolute (an upload) is used as it is. */
const isApiPath = (path: string) => path.startsWith('/api/')

export const catalogFileUrl = (path: string) =>
  isApiPath(path) ? path : `/api/catalog/files/${path.split('/').map(encodeURIComponent).join('/')}`

/** A catalog piece's model lives with the catalog; any other mesh lives in the room folder. */
export const meshUrl = (id: string, mesh: string) =>
  isApiPath(mesh)
    ? mesh
    : mesh.startsWith('catalog/')
      ? catalogFileUrl(mesh.slice('catalog/'.length))
      : `/files/${encodeURIComponent(id)}/${mesh.split('/').map(encodeURIComponent).join('/')}`

export function formatPrice(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
