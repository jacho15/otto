import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { currentViolations, defaultExpiry, errorText, hasListedPrice, isGoogleUrl, mandateSummary, needsGoogleNote, orderedNames, parseLimit, parseShops, roomShops, violationsOf } from './checkoutLogic'
import type { Mandate, Order, OrderItem, RoomObject } from './types'

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

describe('mandateSummary currency', () => {
  it('formats the limits in the mandate currency', () => {
    const m = {
      max_item_price: 300,
      max_total: 1000,
      shops: ['shop.se'],
      expires: null,
      currency: 'EUR',
      token_last4: '1234',
      token_id: 't',
      created_at: '',
    }
    expect(mandateSummary(m).slice(0, 2)).toEqual(['Up to €300.00 per item', 'Up to €1,000.00 per order'])
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
  it('flags items in another currency and counts only the mandate currency in the caps', () => {
    const eur = (title: string, price: number): OrderItem => ({ ...item(title, price), currency: 'EUR' })
    expect(currentViolations([eur('Lamp', 1e6)], mandate(), today)).toEqual(['Lamp: Price is in EUR; your limits are in USD.'])
    expect(currentViolations([item('Sofa', 100), eur('Lamp', 500), item('Chair', 50)], mandate({ max_total: 150 }), today)).toEqual([
      'Lamp: Price is in EUR; your limits are in USD.',
    ])
    expect(currentViolations([item('Sofa', 100), eur('Lamp', 500), item('Chair', 50.01)], mandate({ max_total: 150 }), today)).toEqual([
      'Lamp: Price is in EUR; your limits are in USD.',
      'The total $150.01 is over the limit of $150.00.',
    ])
  })
  it('formats with the mandate currency and treats a missing currency as USD', () => {
    const m = mandate({ currency: 'EUR', max_item_price: 100, max_total: 150 })
    const eur = (title: string, price: number): OrderItem => ({ ...item(title, price), currency: 'EUR' })
    expect(currentViolations([eur('Lamp', 100.01)], m, today)).toEqual([
      'Lamp costs €100.01, over the per-item limit of €100.00.',
    ])
    expect(currentViolations([item('Sofa', 10)], m, today)).toEqual(['Sofa: Price is in USD; your limits are in EUR.'])
    const bare = { ...item('Sofa', 10), currency: undefined } as unknown as OrderItem
    expect(currentViolations([bare], mandate(), today)).toEqual([])
    expect(currentViolations([bare], m, today)).toEqual(['Sofa: Price is in USD; your limits are in EUR.'])
  })
  it('flags an expired mandate', () => {
    expect(currentViolations(items, mandate({ expires: '2026-01-27' }), today)).toEqual(['The mandate expired on 2026-01-27.'])
    expect(currentViolations(items, mandate({ expires: '2026-01-28' }), today)).toEqual([])
  })
})

describe('hasListedPrice', () => {
  const piece = (name: string, product?: RoomObject['product']): RoomObject =>
    ({ name, label: 'sofa', pos: [0, 0, 0], yaw: 0, size: [1, 1, 1], mesh: null, product }) as RoomObject
  const objects = [
    piece('listed', { title: 'A', url: 'https://x.test/a', price: 10, currency: 'USD', price_source: 'listing' }),
    piece('checked', { title: 'B', url: 'https://x.test/b', price: 10, currency: 'USD', price_source: 'page' }),
    piece('old', { title: 'C', url: 'https://x.test/c', price: 10, currency: 'USD' }),
    piece('bare'),
  ]
  it('is true only for a price that came from a listing', () => {
    expect(hasListedPrice(objects, 'listed')).toBe(true)
    expect(hasListedPrice(objects, 'checked')).toBe(false)
    expect(hasListedPrice(objects, 'old')).toBe(false)
    expect(hasListedPrice(objects, 'bare')).toBe(false)
  })
  it('is false for a piece that is not in the room', () => {
    expect(hasListedPrice(objects, 'gone')).toBe(false)
    expect(hasListedPrice([], 'listed')).toBe(false)
  })
})

describe('isGoogleUrl', () => {
  it('is true for google.com and its subdomains', () => {
    expect(isGoogleUrl('https://www.google.com/shopping/product/1')).toBe(true)
    expect(isGoogleUrl('https://google.com/x')).toBe(true)
    expect(isGoogleUrl('https://shopping.google.com/x')).toBe(true)
  })
  it('is false for other hosts and bad links', () => {
    expect(isGoogleUrl('https://www.wayfair.com/google.com')).toBe(false)
    expect(isGoogleUrl('https://notgoogle.com/x')).toBe(false)
    expect(isGoogleUrl('https://google.com.evil.test/x')).toBe(false)
    expect(isGoogleUrl('not a link')).toBe(false)
  })
})

describe('roomShops', () => {
  const piece = (url?: string, hidden?: boolean): RoomObject =>
    ({
      name: 'p', label: 'sofa', pos: [0, 0, 0], yaw: 0, size: [1, 1, 1], mesh: null, hidden,
      product: url ? { title: 'A', url, price: 10, currency: 'USD' } : undefined,
    }) as RoomObject
  it('lists unique hosts with ikea.com first, then room order', () => {
    const objects = [piece('https://www.wayfair.com/a'), piece('https://www.ikea.com/b'), piece('https://example.com/c'), piece('https://wayfair.com/d')]
    expect(roomShops(objects)).toBe('ikea.com, wayfair.com, example.com')
  })
  it('keeps room order when there is no ikea.com piece', () => {
    expect(roomShops([piece('https://b.test/a'), piece('https://a.test/a')])).toBe('b.test, a.test')
  })
  it('skips hidden pieces, missing links, Google links and bad links', () => {
    const objects = [piece('https://x.test/a', true), piece(), piece('https://www.google.com/shopping/product/1'), piece('not a link'), piece('https://y.test/a')]
    expect(roomShops(objects)).toBe('y.test')
  })
  it('falls back to ikea.com', () => {
    expect(roomShops([])).toBe('ikea.com')
    expect(roomShops([piece('https://www.google.com/x')])).toBe('ikea.com')
  })
})

describe('needsGoogleNote', () => {
  const piece = (name: string, price_source?: 'listing' | 'page'): RoomObject =>
    ({
      name, label: 'sofa', pos: [0, 0, 0], yaw: 0, size: [1, 1, 1], mesh: null,
      product: { title: 'A', url: 'https://x.test/a', price: 10, currency: 'USD', price_source },
    }) as RoomObject
  const objects = [piece('listed', 'listing'), piece('checked', 'page')]
  const google = 'https://www.google.com/shopping/product/1'
  it('needs a listed price and a Google link', () => {
    expect(needsGoogleNote(objects, 'listed', google)).toBe(true)
    expect(needsGoogleNote(objects, 'listed', 'https://www.wayfair.com/a')).toBe(false)
    expect(needsGoogleNote(objects, 'checked', google)).toBe(false)
    expect(needsGoogleNote(objects, 'gone', google)).toBe(false)
  })
})
