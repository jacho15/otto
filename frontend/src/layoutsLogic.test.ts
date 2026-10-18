import { describe, expect, it } from 'vitest'
import { cheapestId } from './layoutsLogic'
import type { Layout } from './types'

const layout = (id: string, amount: number): Layout => ({
  id,
  name: id,
  saved_at: '2026-01-01T00:00:00Z',
  count: 3,
  total: { amount, currency: 'USD' },
})

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
