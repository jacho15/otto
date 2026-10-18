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
  mesh: string | null // null: no model yet, drawn as a stand-in of `shape`
  shape?: string
  pos: Vec3
  yaw: number
  size: Vec3
  movable: boolean
  rgba: [number, number, number, number]
  product?: Product
  hidden?: boolean // a ghost: replaced by another piece, kept so the swap can be undone
  replaces?: string // name of the piece this one replaced
  catalog_id?: string
  normalize?: boolean // an uploaded model: fit it to `size` (y-up, any units)
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

export interface Money {
  amount: number
  currency: string
}

/** A total across currencies: `amount` is null and `currency` is "MIXED" when there are several. */
export interface Total {
  amount: number | null
  currency: string
}

export interface Door {
  width: number // metres
  height: number
}

export interface Room {
  id: string
  name: string
  room: RoomShape
  objects: RoomObject[]
  warnings: Warning[]
  total: Total
  totals: Money[]
  can_undo: boolean
  door: Door
}

export interface Layout {
  id: string
  name: string
  saved_at: string
  count: number
  total: Total
  totals: Money[]
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
  model: string | null
  photo: string | null
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
  currency?: string // the limits are in this currency; USD when missing
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
  total: number | null // null when the items are in several currencies
  currency: string // "MIXED" then
  totals: Money[]
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

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  changes?: DesignChange[]
}

export interface ChatState {
  messages: ChatMessage[]
  prefs: string[]
}

export interface ChatReply {
  reply: string
  changes: DesignChange[]
  prefs: string[]
  room: Room
  /** True when the request failed after some changes were saved. The reply says so. */
  partial?: boolean
}

export interface Suggestion {
  catalog_id: string
  title: string
  label: string
  price: number
  currency: string
  url: string
  size: Vec3 // metres
  rgba: [number, number, number, number]
  model: string | null
  photo: string | null
  shape?: string
  pos: Vec2
  yaw: number // radians
  reason: string
  mandate_ok: boolean
  violations: string[]
}

export interface Alternative extends CatalogItem {
  shape?: string
  savings: number
  savings_pct: number // whole percent
  fits: boolean
  problems: string[]
}

export interface AlternativesResult {
  object: string
  price: number | null
  currency: string
  alternatives: Alternative[] // fits first, then the biggest savings
}

export interface SuggestResult {
  message: string
  suggestions: Suggestion[]
}

/** What reading a product link found. Anything missing is null; `notes` says what the user should check. */
export interface LinkDraft {
  title: string
  price: number | null
  currency: string | null
  url: string
  image_url: string | null
  size: Vec3 | null // metres
  label: string
  notes: string[]
}

export interface UploadResult {
  url: string
  kind: 'image' | 'model'
}

export interface CustomItem {
  id: string
  title: string
  url: string
  price: number | null
  currency: string
  size: Vec3 // metres
  label: string
  rgba: [number, number, number, number]
  model: string | null
  photo: string | null
  custom: true
  created_at: string
}

export interface NewCustomItem {
  title: string
  url?: string
  price?: number | null
  currency: string
  size: Vec3 // metres
  label: string
  photo?: string
  model?: string
  image_url?: string
}

export interface DataItem {
  kind: string
  label: string
  count: number
  detail: string
}

export interface DataSummary {
  items: DataItem[]
  note: string
}

/** A piece found on IKEA. It is not in the catalog: swapping it in first saves it as a custom item. */
export interface IkeaAlternative {
  id: string
  title: string
  label: string
  url: string
  price: number | null
  currency: string
  size: Vec3 // metres
  rgba: [number, number, number, number]
  model: null
  photo: null
  source: 'ikea'
  catalog_id: null
  image_url: string | null
  similarity: number // 0 to 1
  why: string
  savings: number | null // null when the piece being replaced has no price
  savings_pct: number | null // whole percent
  fits: boolean
  problems: string[]
}

export interface IkeaResult {
  object: string
  price: number | null
  currency: string
  alternatives: IkeaAlternative[] // fits first, then the biggest savings
  message: string
}
