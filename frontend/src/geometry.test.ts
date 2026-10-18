import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  findWarnings,
  formatDistance,
  footprintCorners,
  footprintGap,
  footprintsOverlap,
  isTight,
  outsideWalls,
  roomToThree,
  snapToWalls,
  threeToRoom,
  wallGaps,
  warnedNames,
} from './geometry'
import type { RoomObject, Vec3 } from './types'

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

describe('coordinates', () => {
  it('maps room z-up to three y-up', () => {
    expect(roomToThree([1, 2, 3])).toEqual([1, 3, -2])
  })

  it('round trips', () => {
    const p: Vec3 = [0.4, -1.7, 0.25]
    close(threeToRoom(roomToThree(p)), p)
    close(roomToThree(threeToRoom(p)), p)
  })

  it('room yaw +90deg turns local +x toward room +y', () => {
    const v = new Vector3(1, 0, 0).applyEuler(new Euler(0, Math.PI / 2, 0))
    close(threeToRoom([v.x, v.y, v.z]), [0, 1, 0])
  })

  it('footprint corners rotate the same way', () => {
    // 2 x 0 footprint at origin, yaw +90deg: local +x end ends up at room +y
    const c = footprintCorners([0, 0], [2, 0], Math.PI / 2)
    close(c[1], [0, 1])
  })
})

describe('footprints', () => {
  const box = (x: number, y: number, w = 1, d = 1, yaw = 0) => footprintCorners([x, y], [w, d], yaw)

  it('touching edges do not overlap', () => {
    expect(footprintsOverlap(box(0, 0), box(1, 0))).toBe(false)
  })

  it('overlap within 1 mm counts as touching', () => {
    expect(footprintsOverlap(box(0, 0), box(0.9995, 0))).toBe(false)
    expect(footprintsOverlap(box(0, 0), box(0.998, 0))).toBe(true)
  })

  it('handles rotated rectangles', () => {
    // a diamond whose tip just misses the square corner region
    expect(footprintsOverlap(box(0, 0), box(1.3, 1.3, 1, 1, Math.PI / 4))).toBe(false)
    expect(footprintsOverlap(box(0, 0), box(1.1, 0, 1, 1, Math.PI / 4))).toBe(true)
  })

  it('flags wall crossing beyond 1 mm', () => {
    expect(outsideWalls(box(1.5, 0), [4, 4])).toBe(false)
    expect(outsideWalls(box(1.5005, 0), [4, 4])).toBe(false)
    expect(outsideWalls(box(1.502, 0), [4, 4])).toBe(true)
  })
})

describe('parity cases', () => {
  const rect = (x: number, y: number, w: number, d: number, yaw: number) =>
    footprintCorners([x, y], [w, d], yaw)
  const hit = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => footprintsOverlap(a, b)

  it('flush rects do not overlap', () => {
    expect(hit(rect(0, 0, 1, 1, 0), rect(1, 0, 1, 1, 0))).toBe(false)
  })

  it('rects 2 mm into each other overlap', () => {
    expect(hit(rect(0, 0, 1, 1, 0), rect(0.998, 0, 1, 1, 0))).toBe(true)
  })

  it('a rect crossed with its quarter turn overlaps', () => {
    expect(hit(rect(0, 0, 2, 0.5, 0), rect(0, 0, 2, 0.5, Math.PI / 2))).toBe(true)
  })

  it('a rotated square reaches over a flush gap', () => {
    expect(hit(rect(0, 0, 1, 1, Math.PI / 4), rect(1.2, 0, 1, 1, 0))).toBe(true)
  })

  it('a zero-width rect skips its degenerate axis and does not crash', () => {
    // A has width 0: its zero-length edge is skipped, the x axis is tested and has zero overlap depth
    expect(hit(rect(0, 0, 0, 1, 0), rect(0, 0, 1, 1, 0))).toBe(false)
  })

  it('wall warning starts beyond 1 mm', () => {
    const o = (x: number): RoomObject => ({
      name: 'p', label: 'p', mesh: '', pos: [x, 0, 0], yaw: 0, size: [1, 1, 1], movable: true, rgba: [1, 1, 1, 1],
    })
    expect(findWarnings([o(1.5)], [4, 3])).toEqual([])
    expect(findWarnings([o(1.502)], [4, 3])).toEqual([{ type: 'wall', object: 'p' }])
  })
})

describe('findWarnings', () => {
  const obj = (name: string, x: number, y: number): RoomObject => ({
    name,
    label: name,
    mesh: '',
    pos: [x, y, 0],
    yaw: 0,
    size: [1, 1, 1],
    movable: true,
    rgba: [1, 1, 1, 1],
  })

  it('reports overlaps and walls like the server', () => {
    const w = findWarnings([obj('a', 0, 0), obj('b', 0.5, 0), obj('c', 2, 0)], [4, 4])
    expect(w).toEqual([
      { type: 'overlap', objects: ['a', 'b'] },
      { type: 'wall', object: 'c' },
    ])
    expect([...warnedNames(w)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('skips hidden objects', () => {
    const ghost = { ...obj('b', 0.5, 0), hidden: true }
    const outside = { ...obj('c', 2, 0), hidden: true }
    expect(findWarnings([obj('a', 0, 0), ghost, outside], [4, 4])).toEqual([])
  })
})

describe('wallGaps', () => {
  it('measures each side of an axis-aligned footprint', () => {
    const g = wallGaps(footprintCorners([1, -0.5], [1, 0.5], 0), [5, 4])
    expect(g['+x']).toBeCloseTo(1, 9)
    expect(g['-x']).toBeCloseTo(3, 9)
    expect(g['+y']).toBeCloseTo(2.25, 9)
    expect(g['-y']).toBeCloseTo(1.25, 9)
  })

  it('goes negative past a wall', () => {
    expect(wallGaps(footprintCorners([2.4, 0], [1, 1], 0), [5, 4])['+x']).toBeCloseTo(-0.4, 9)
  })
})

describe('footprintGap', () => {
  const box = (x: number, y: number, w = 1, d = 1, yaw = 0) => footprintCorners([x, y], [w, d], yaw)

  it('measures a straight gap between facing sides', () => {
    const g = footprintGap(box(0, 0), box(2, 0.2))
    expect(g.gap).toBeCloseTo(1, 9)
    expect(g.from[0]).toBeCloseTo(0.5, 9)
    expect(g.to).toEqual([1.5, g.from[1]])
  })

  it('is the same from either side, with the points swapped', () => {
    const ab = footprintGap(box(0, 0), box(2, 0.2))
    const ba = footprintGap(box(2, 0.2), box(0, 0))
    expect(ba.gap).toBeCloseTo(ab.gap, 9)
    // facing sides tie along y, so only x is pinned down
    expect(ba.from[0]).toBeCloseTo(ab.to[0], 9)
    expect(ba.to[0]).toBeCloseTo(ab.from[0], 9)
  })

  it('measures corner to corner', () => {
    const g = footprintGap(box(0, 0), box(2, 2))
    expect(g.gap).toBeCloseTo(Math.SQRT2, 9)
    close(g.from, [0.5, 0.5])
    close(g.to, [1.5, 1.5])
  })

  it('measures a rotated rectangle', () => {
    // a diamond with half-diagonal sqrt(2)/2 centred 2 away: its tip is at x = 2 - sqrt(2)/2
    const g = footprintGap(box(0, 0), box(2, 0, 1, 1, Math.PI / 4))
    expect(g.gap).toBeCloseTo(1.5 - Math.SQRT2 / 2, 9)
    close(g.from, [0.5, 0])
    close(g.to, [2 - Math.SQRT2 / 2, 0])
  })

  it('is zero when touching or overlapping', () => {
    expect(footprintGap(box(0, 0), box(0.5, 0)).gap).toBe(0)
    expect(footprintGap(box(0, 0), box(1, 0)).gap).toBeCloseTo(0, 9)
  })
})

describe('formatDistance', () => {
  it('uses cm under a metre and m above', () => {
    expect(formatDistance(0.354)).toBe('35 cm')
    expect(formatDistance(1.254)).toBe('1.25 m')
  })
})

describe('snapToWalls', () => {
  const room: [number, number] = [4, 3]

  it('moves a piece flush against a wall within 12 cm', () => {
    // 1 x 0.5 piece: centre 1.4 puts its right edge at 1.9, 10 cm from the +x wall
    close(snapToWalls([1.4, 0], [1, 0.5], 0, room), [1.5, 0])
    close(snapToWalls([-1.45, 0], [1, 0.5], 0, room), [-1.5, 0])
  })

  it('leaves a piece alone beyond 12 cm', () => {
    close(snapToWalls([1.3, 0.2], [1, 0.5], 0, room), [1.3, 0.2])
  })

  it('snaps both axes into a corner', () => {
    close(snapToWalls([1.45, 1.2], [1, 0.5], 0, room), [1.5, 1.25])
  })

  it('uses the rotated extent', () => {
    // turned 90 degrees the piece is 0.5 wide and 1 deep on screen
    close(snapToWalls([1.7, 0], [1, 0.5], Math.PI / 2, room), [1.75, 0])
    close(snapToWalls([0, 1.0], [1, 0.5], Math.PI / 2, room), [0, 1])
    close(snapToWalls([0, 0.95], [1, 0.5], Math.PI / 2, room), [0, 1])
  })

  it('pulls a piece that pokes a little through the wall back in', () => {
    close(snapToWalls([1.55, 0], [1, 0.5], 0, room), [1.5, 0])
  })
})

describe('isTight', () => {
  it('is true for a gap over 0 and under 60 cm', () => {
    expect(isTight(0.48)).toBe(true)
    expect(isTight(0.599)).toBe(true)
    expect(isTight(0.6)).toBe(false)
    expect(isTight(0)).toBe(false)
  })
})
