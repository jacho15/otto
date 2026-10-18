import { describe, expect, it } from 'vitest'
import { PLANK_WIDTH, TILE_H, TILE_ROWS, TILE_W, floorRepeat, plankLayout, seededRandom } from './floorPlanks'

describe('plankLayout', () => {
  const planks = plankLayout()

  it('covers the whole tile with no gaps', () => {
    const area = planks.reduce((sum, p) => sum + p.w * p.h, 0)
    expect(area).toBeCloseTo(1, 9)
  })

  it('has rows that each run the full width, in order', () => {
    for (let row = 0; row < TILE_ROWS; row++) {
      const inRow = planks.filter((p) => p.y === row / TILE_ROWS)
      expect(inRow.length).toBe(3)
      let x = 0
      for (const p of inRow) {
        expect(p.x).toBeCloseTo(x, 9)
        x += p.w
      }
      expect(x).toBeCloseTo(1, 9)
    }
  })

  it('gives the pieces either side of the tile edge the same shade', () => {
    for (let row = 0; row < TILE_ROWS; row++) {
      const inRow = planks.filter((p) => p.y === row / TILE_ROWS)
      expect(inRow[0].shade).toBe(inRow[2].shade)
    }
  })

  it('is the same every time', () => {
    expect(plankLayout()).toEqual(planks)
  })

  it('keeps shades in range', () => {
    for (const p of planks) expect(Math.abs(p.shade)).toBeLessThanOrEqual(1)
  })
})

describe('floorRepeat', () => {
  it('makes planks 15 cm wide at room scale', () => {
    expect(TILE_H / TILE_ROWS).toBeCloseTo(PLANK_WIDTH, 9)
    const [, ry] = floorRepeat(4, 3)
    expect(3 / ry / TILE_ROWS).toBeCloseTo(0.15, 9)
  })

  it('repeats the tile once per tile of floor', () => {
    expect(floorRepeat(TILE_W, TILE_H)).toEqual([1, 1])
    expect(floorRepeat(TILE_W * 3, TILE_H * 2)).toEqual([3, 2])
  })
})

describe('seededRandom', () => {
  it('repeats for a seed and stays in [0, 1)', () => {
    const a = seededRandom(5)
    const b = seededRandom(5)
    for (let i = 0; i < 50; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
