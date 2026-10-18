export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export interface Product {
  title: string
  url: string
  price?: number | null
  currency: string
}

export interface RoomObject {
  name: string
  label: string
  mesh: string
  pos: Vec3
  yaw: number
  size: Vec3
  movable: boolean
  rgba: [number, number, number, number]
  product?: Product
  hidden?: boolean // a ghost: replaced by another piece, kept so the swap can be undone
  replaces?: string // name of the piece this one replaced
  catalog_id?: string
}

export type Warning =
  | { type: 'overlap'; objects: [string, string] }
  | { type: 'wall'; object: string }

export interface RoomShape {
  size_xy: Vec2
  ceiling_height: number
  wall_thickness: number
  point_cloud?: string // .ply path relative to the room folder, from a scan
}

export interface Room {
  id: string
  name: string
  room: RoomShape
  objects: RoomObject[]
  warnings: Warning[]
  total: { amount: number; currency: string }
}

export interface AddResult extends Room {
  added: string
}

export interface CatalogItem {
  id: string
  title: string
  label: string
  url: string
  price: number
  currency: string
  size: Vec3 // metres
  rgba: [number, number, number, number]
  model: string
  photo: string
}

export interface RoomSummary {
  id: string
  name: string
  size_xy: Vec2
  object_count: number
  kind: 'blueprint' | 'scan'
}

export interface MandateInput {
  max_item_price: number | null
  max_total: number | null
  shops: string[]
  expires: string | null // YYYY-MM-DD
}

export interface Mandate extends MandateInput {
  token_last4: string
  token_id: string
  created_at: string
}

export interface OrderItem {
  object_name: string
  title: string
  url: string
  price: number
  currency: string
  reason: string
}

export interface Payment {
  provider: 'mock-visa'
  auth_id: string
  token_last4: string
  amount: number
  currency: string
  demo: true
  note: string
}

export interface Order {
  id: string
  room_id: string
  status: 'proposed' | 'approved' | 'cancelled'
  items: OrderItem[]
  total: number
  currency: string
  violations: string[]
  created_at: string
  created_by: 'agent'
  agent_message: string
  payment: Payment | null
}

export interface NewRoomInput {
  name: string
  width: number // metres
  depth: number
  height: number
}

export interface SavedItem {
  catalog_id: string
  note: string
  saved_at: string
  item: CatalogItem
}

export interface DesignChange {
  action: 'placed' | 'moved' | 'removed'
  name: string
  title: string
}

export interface DesignResult {
  message: string
  changes: DesignChange[]
  room: Room
}
