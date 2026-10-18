// Does a catalog product fit in this room, and in what order to show products.
// Same rules as placing a piece on the server (backend/otto_api/place.py): a spot on a grid,
// turned 0 or 90 degrees, inside the walls and clear of every visible piece.
import { footprintCorners, footprintsOverlap, outsideWalls } from './geometry'
import type { CatalogItem, RoomObject, RoomShape, Vec2, Vec3 } from './types'

const STEP = 0.1 // 10 cm grid: coarser than the server's 5 cm so it stays fast while you drag
const YAWS = [0, Math.PI / 2]

export type Fit = 'fits' | 'too-tall' | 'too-big' | 'no-space'

export const FIT_TEXT: Record<Fit, string> = {
  fits: 'Fits',
  'too-tall': 'Taller than the ceiling',
  'too-big': 'Bigger than the room',
  'no-space': 'No free floor space',
}

/** A free spot for a footprint of `size`, nearest the room centre, or null. */
export function findFreeSpot(size: Vec2 | Vec3, room: RoomShape, objects: RoomObject[]): { pos: Vec2; yaw: number } | null {
  const [W, D] = room.size_xy
  const nx = Math.floor(W / 2 / STEP)
  const ny = Math.floor(D / 2 / STEP)
  const others = objects.filter((o) => !o.hidden).map((o) => footprintCorners(o.pos, o.size, o.yaw))
  const spots: Vec2[] = []
  for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) spots.push([i * STEP, j * STEP])
  spots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  for (const pos of spots) {
    for (const yaw of YAWS) {
      const corners = footprintCorners(pos, size, yaw)
      if (outsideWalls(corners, room.size_xy)) continue
      if (!others.some((c) => footprintsOverlap(corners, c))) return { pos, yaw }
    }
  }
  return null
}

export function productFit(size: Vec3, room: RoomShape, objects: RoomObject[]): Fit {
  if (size[2] > room.ceiling_height) return 'too-tall'
  if (!findFreeSpot(size, room, [])) return 'too-big'
  return findFreeSpot(size, room, objects) ? 'fits' : 'no-space'
}

export type SortKey = 'fit' | 'price-asc' | 'price-desc' | 'size' | 'type'

export const SORT_TEXT: Record<SortKey, string> = {
  fit: 'Fits first',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  size: 'Size: smallest first',
  type: 'Type',
}

const area = (i: CatalogItem) => i.size[0] * i.size[1]

/** A sorted copy. Ties fall back to price, then title, so the order never jumps around. */
export function sortItems(items: CatalogItem[], fits: Map<string, Fit>, key: SortKey): CatalogItem[] {
  const byPrice = (a: CatalogItem, b: CatalogItem) => a.price - b.price || a.title.localeCompare(b.title)
  const compare: Record<SortKey, (a: CatalogItem, b: CatalogItem) => number> = {
    fit: (a, b) => Number(fits.get(a.id) !== 'fits') - Number(fits.get(b.id) !== 'fits') || byPrice(a, b),
    'price-asc': byPrice,
    'price-desc': (a, b) => b.price - a.price || a.title.localeCompare(b.title),
    size: (a, b) => area(a) - area(b) || byPrice(a, b),
    type: (a, b) => a.label.localeCompare(b.label) || byPrice(a, b),
  }
  return [...items].sort(compare[key])
}
