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

export interface RoomSummary {
  id: string
  name: string
  size_xy: Vec2
  object_count: number
}
