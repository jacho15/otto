import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { currentViolations, defaultExpiry, errorText, mandateSummary, orderedNames, parseLimit, parseShops, violationsOf } from './checkoutLogic'
import type { Mandate, Order, OrderItem } from './types'

describe('parseShops', () => {
  it('trims, lowercases, drops empties and duplicates', () => {
    expect(parseShops(' IKEA.com, ,ikea.com,example.com,')).toEqual(['ikea.com', 'example.com'])
    expect(parseShops('')).toEqual([])
  })
})

describe('defaultExpiry', () => {
  it('is 7 days out, across a month end', () => {
    expect(defaultExpiry(new Date(2026, 0, 28))).toBe('2026-02-04')
  })
})

describe('parseLimit', () => {
  it('maps empty to no limit and rejects bad numbers', () => {
    expect(parseLimit('  ')).toBeNull()
    expect(parseLimit('250.5')).toBe(250.5)
    expect(parseLimit('abc')).toBeUndefined()
    expect(parseLimit('0')).toBe(0)
    expect(parseLimit('-5')).toBeUndefined()
  })
})

describe('mandateSummary', () => {
  const m: Mandate = {
    max_item_price: 300,
    max_total: null,
    shops: ['ikea.com', 'example.com'],
    expires: '2026-02-04',
    token_last4: '1234',
    token_id: 't',
    created_at: '',
  }
  it('describes limits, shops and expiry', () => {
    expect(mandateSummary(m)).toEqual([
      'Up to $300.00 per item',
      'No limit per order',
      'Shops: ikea.com, example.com',
      'Expires 2026-02-04',
    ])
  })
})

describe('orderedNames', () => {
  const order = (status: Order['status'], names: string[]) =>
    ({ status, items: names.map((object_name) => ({ object_name })) }) as Order
  it('collects names from approved orders only', () => {
    const names = orderedNames([order('approved', ['sofa']), order('proposed', ['lamp']), order('cancelled', ['rug'])])
    expect([...names]).toEqual(['sofa'])
  })
})

describe('error helpers', () => {
  it('reads a string detail', () => {
    expect(errorText(new ApiError(503, 'No API key'))).toBe('No API key')
    expect(errorText(new ApiError(500, undefined))).toBe('Server error 500.')
    expect(errorText(new Error('Cannot reach the Otto server.'))).toBe('Cannot reach the Otto server.')
  })
  it('reads violations from a 409', () => {
    expect(violationsOf(new ApiError(409, { violations: ['Over limit'] }))).toEqual(['Over limit'])
    expect(violationsOf(new ApiError(409, 'No mandate'))).toBeNull()
    expect(violationsOf(new Error('x'))).toBeNull()
  })
})

describe('currentViolations', () => {
  const item = (title: string, price: number, url = 'https://www.ikea.com/p/x'): OrderItem =>
    ({ object_name: title, title, url, price, currency: 'USD', reason: '' })
  const mandate = (patch: Partial<Mandate> = {}): Mandate => ({
    max_item_price: null,
    max_total: null,
    shops: [],
    expires: null,
    token_last4: '1234',
    token_id: 't',
    created_at: '',
    ...patch,
  })
  const today = new Date(2026, 0, 28)
  const items = [item('Sofa', 400), item('Chair', 60)]

  it('is empty when the items fit', () => {
    expect(currentViolations(items, mandate(), today)).toEqual([])
    expect(currentViolations(items, mandate({ max_item_price: 400, max_total: 460, shops: ['ikea.com'] }), today)).toEqual([])
  })
  it('checks the item cap and the total cap', () => {
    expect(currentViolations(items, mandate({ max_item_price: 100 }), today)).toEqual([
      'Sofa costs $400.00, over the per-item limit of $100.00.',
    ])
    expect(currentViolations(items, mandate({ max_total: 450 }), today)).toEqual([
      'The total $460.00 is over the limit of $450.00.',
    ])
  })
  it('clears once the limits are raised', () => {
    const old = mandate({ max_item_price: 100, max_total: 450 })
    expect(currentViolations(items, old, today)).toHaveLength(2)
    expect(currentViolations(items, { ...old, max_item_price: 500, max_total: 500 }, today)).toEqual([])
  })
  it('matches shops by host, including subdomains', () => {
    const shops = mandate({ shops: ['ikea.com'] })
    expect(currentViolations([item('A', 1, 'https://us.ikea.com/a')], shops, today)).toEqual([])
    for (const url of ['https://ikea.com.evil.com/a', 'https://evil.com\@ikea.com/a', 'javascript:alert(1)', '']) {
      expect(currentViolations([item('A', 1, url)], shops, today)).toEqual(['A is not from an allowed shop.'])
    }
  })
  it('flags an expired mandate', () => {
    expect(currentViolations(items, mandate({ expires: '2026-01-27' }), today)).toEqual(['The mandate expired on 2026-01-27.'])
    expect(currentViolations(items, mandate({ expires: '2026-01-28' }), today)).toEqual([])
  })
})
