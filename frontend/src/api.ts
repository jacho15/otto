import type { Room, RoomSummary, Vec2 } from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error('Cannot reach the Otto server.')
  }
  // The dev proxy answers 502-504 when the backend is down.
  if (res.status >= 502 && res.status <= 504) throw new Error('Cannot reach the Otto server.')
  if (!res.ok) throw new Error(`Server error ${res.status}.`)
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

export const meshUrl = (id: string, mesh: string) => `/files/${encodeURIComponent(id)}/${mesh.split('/').map(encodeURIComponent).join('/')}`

export function formatPrice(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
