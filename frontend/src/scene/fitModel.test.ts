import { describe, expect, it } from 'vitest'
import { fitTransform } from './fitModel'
import type { Vec3 } from '../types'

const apply = (t: ReturnType<typeof fitTransform>, p: Vec3): Vec3 => [
  t.position[0] + t.scale[0] * p[0],
  t.position[1] + t.scale[1] * p[1],
  t.position[2] + t.scale[2] * p[2],
]

describe('fitTransform', () => {
  const bounds = { min: [1, 2, 3] as Vec3, max: [3, 6, 7] as Vec3 } // 2 wide, 4 tall, 4 deep

  it('stretches width to x, height to y and depth to z', () => {
    const t = fitTransform(bounds, [1, 2, 4]) // w, d, h
    expect(t.scale).toEqual([0.5, 1, 0.5])
  })

  it('centres the footprint and puts the base on the floor', () => {
    const t = fitTransform(bounds, [1, 2, 4])
    const lo = apply(t, bounds.min)
    const hi = apply(t, bounds.max)
    expect(lo[0]).toBeCloseTo(-0.5)
    expect(hi[0]).toBeCloseTo(0.5)
    expect(lo[1]).toBeCloseTo(0)
    expect(hi[1]).toBeCloseTo(4)
    expect(lo[2]).toBeCloseTo(-1)
    expect(hi[2]).toBeCloseTo(1)
  })

  it('handles a model in other units, centred away from the origin', () => {
    const t = fitTransform({ min: [-500, -20, 100], max: [500, 80, 300] }, [2, 0.8, 0.9]) // millimetres
    const lo = apply(t, [-500, -20, 100])
    const hi = apply(t, [500, 80, 300])
    expect(lo[0]).toBeCloseTo(-1)
    expect(hi[0]).toBeCloseTo(1)
    expect(lo[1]).toBeCloseTo(0)
    expect(hi[1]).toBeCloseTo(0.9)
    expect(lo[2]).toBeCloseTo(-0.4)
    expect(hi[2]).toBeCloseTo(0.4)
  })

  it('leaves a flat axis alone instead of dividing by zero', () => {
    const t = fitTransform({ min: [0, 0, 0], max: [1, 0, 1] }, [1, 1, 1])
    expect(t.scale).toEqual([1, 1, 1])
    expect(t.position.every(Number.isFinite)).toBe(true)
  })
})
