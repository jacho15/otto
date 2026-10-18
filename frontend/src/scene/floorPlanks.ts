/** Layout of the procedural wood floor: one texture tile of planks, repeated across the room. */

export const PLANK_WIDTH = 0.15 // metres, across the grain
export const TILE_ROWS = 8
export const TILE_H = PLANK_WIDTH * TILE_ROWS // 1.2 m: the tile is this tall...
export const TILE_W = TILE_H * 2 // ...and twice as wide, so planks run along x

/** One plank as fractions of the tile. `shade` is in [-1, 1]: how much lighter or darker than the base colour. */
export interface Plank {
  x: number
  y: number
  w: number
  h: number
  shade: number
}

/** A small deterministic random source, so the floor looks the same on every load. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The planks of one tile, row by row. Each row has two joints half a tile apart, at a different place per row.
 * The pieces on either side of the tile edge are the same plank, so they share a shade and the tile repeats cleanly.
 */
export function plankLayout(seed = 7): Plank[] {
  const rand = seededRandom(seed)
  const h = 1 / TILE_ROWS
  const planks: Plank[] = []
  for (let row = 0; row < TILE_ROWS; row++) {
    const a = 0.1 + rand() * 0.4
    const b = a + 0.5
    const edge = rand() * 2 - 1
    const middle = rand() * 2 - 1
    const y = row * h
    planks.push({ x: 0, y, w: a, h, shade: edge })
    planks.push({ x: a, y, w: b - a, h, shade: middle })
    planks.push({ x: b, y, w: 1 - b, h, shade: edge })
  }
  return planks
}

/** How many times the tile repeats across a floor of W by D metres. */
export function floorRepeat(W: number, D: number): [number, number] {
  return [W / TILE_W, D / TILE_H]
}
