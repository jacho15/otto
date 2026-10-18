import { describe, expect, it } from 'vitest'
import { threeToRoom } from '../geometry'
import { tourPose } from './tourPath'
import type { Vec3 } from '../types'

const room = (p: Vec3) => threeToRoom(p) // back to room coordinates (x, y on the floor, z up)

describe('tourPose', () => {
  const size: Vec3 = [0.8, 0.8, 0.8]

  it('stands at eye height and looks at the piece', () => {
    const { position, target } = tourPose(0.5, [5, 4], [1, 1], size)
    expect(room(position)[2]).toBeCloseTo(1.5)
    const [tx, ty, tz] = room(target)
    expect([tx, ty]).toEqual([1, 1])
    expect(tz).toBeGreaterThan(0)
    expect(tz).toBeLessThan(1)
  })

  it('at the middle of the walk, stands between the piece and the room centre', () => {
    const [x, y] = room(tourPose(0.5, [6, 6], [2, 0], size).position)
    expect(x).toBeLessThan(2) // towards the centre from the piece
    expect(Math.abs(y)).toBeLessThan(0.01)
  })

  it('moves from one side to the other', () => {
    const a = room(tourPose(0, [6, 6], [2, 0], size).position)
    const b = room(tourPose(1, [6, 6], [2, 0], size).position)
    expect(Math.sign(a[1])).toBe(-Math.sign(b[1]))
  })

  it('never leaves the room, even for a piece in a corner of a small room', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const [x, y] = room(tourPose(t, [3, 2.5], [1.3, 1.0], [1.8, 0.9, 0.8]).position)
      expect(Math.abs(x)).toBeLessThanOrEqual(1.5 - 0.25 + 1e-9)
      expect(Math.abs(y)).toBeLessThanOrEqual(1.25 - 0.25 + 1e-9)
    }
  })

  it('clamps progress outside 0 to 1', () => {
    expect(tourPose(-1, [5, 4], [1, 1], size)).toEqual(tourPose(0, [5, 4], [1, 1], size))
    expect(tourPose(2, [5, 4], [1, 1], size)).toEqual(tourPose(1, [5, 4], [1, 1], size))
  })
})
