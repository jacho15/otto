import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../types'
import { standInParts } from './standInShapes'

const bounds = (label: string, size: Vec3) => {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of standInParts(label, size)) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p.pos[i] - p.size[i] / 2)
      hi[i] = Math.max(hi[i], p.pos[i] + p.size[i] / 2)
    }
  }
  return { lo, hi }
}

describe('standInParts', () => {
  const cases: [string, Vec3][] = [
    ['sofa', [2.1, 0.9, 0.85]],
    ['loveseat', [1.4, 0.8, 0.8]],
    ['armchair', [0.8, 0.85, 0.9]],
    ['chair', [0.45, 0.5, 0.9]],
    ['coffee table', [1.1, 0.6, 0.45]],
    ['coffee table', [0.8, 0.8, 0.4]],
    ['round coffee table', [0.75, 0.75, 0.45]],
    ['side table', [0.4, 0.4, 0.5]],
    ['desk', [1.4, 0.6, 0.75]],
    ['bookcase', [0.8, 0.3, 1.9]],
    ['lamp', [0.35, 0.35, 1.5]],
    ['mystery', [1, 0.5, 0.7]],
  ]

  it.each(cases)('%s fills its size exactly', (label, [w, d, h]) => {
    const { lo, hi } = bounds(label, [w, d, h])
    const want = [w / 2, d / 2, h]
    for (let i = 0; i < 3; i++) {
      expect(hi[i]).toBeCloseTo(want[i], 6)
      expect(lo[i]).toBeCloseTo(i === 2 ? 0 : -want[i], 6)
    }
  })

  it('puts the sofa backrest at +y', () => {
    const back = standInParts('sofa', [2, 1, 0.9]).find((p) => Math.abs(p.pos[2] + p.size[2] / 2 - 0.9) < 1e-9)!
    expect(back.pos[1]).toBeGreaterThan(0)
  })
})
