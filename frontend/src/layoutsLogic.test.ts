import { describe, expect, it } from 'vitest'
import { cheapestId } from './layoutsLogic'
import type { Layout, Total } from './types'

const layout = (id: string, amount: number | null, currency = 'USD'): Layout => {
  const total: Total = { amount, currency }
  return {
    id,
    name: id,
    saved_at: '2026-01-01T00:00:00Z',
    count: 3,
    total,
    totals: amount == null ? [] : [{ amount, currency }],
  }
}

describe('cheapestId', () => {
  it('picks the lowest total', () => {
    expect(cheapestId([layout('a', 900), layout('b', 650), layout('c', 700)])).toBe('b')
  })

  it('goes to the first on a tie', () => {
    expect(cheapestId([layout('a', 500), layout('b', 500)])).toBe('a')
  })

  it('is null with fewer than two layouts', () => {
    expect(cheapestId([])).toBeNull()
    expect(cheapestId([layout('a', 500)])).toBeNull()
  })
})

describe('cheapestId with several currencies', () => {
  it('is null when a layout has a mixed total', () => {
    expect(cheapestId([layout('a', 900), layout('b', null, 'MIXED')])).toBeNull()
  })

  it('is null when single-currency layouts differ in currency', () => {
    expect(cheapestId([layout('a', 900), layout('b', 500, 'EUR')])).toBeNull()
  })
})
