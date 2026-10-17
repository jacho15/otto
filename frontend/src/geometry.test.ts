import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  findWarnings,
  footprintCorners,
  footprintsOverlap,
  outsideWalls,
  roomToThree,
  threeToRoom,
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
})
