import { describe, expect, it } from 'vitest'
import { sumByCurrency, totalLines } from './moneyLogic'

describe('sumByCurrency', () => {
  it('adds each currency on its own, sorted by currency code', () => {
    const items = [
      { price: 100.1, currency: 'USD' },
      { price: 120, currency: 'EUR' },
      { price: 200.2, currency: 'USD' },
    ]
    expect(sumByCurrency(items)).toEqual([
      { currency: 'EUR', amount: 120 },
      { currency: 'USD', amount: 300.3 },
    ])
  })

  it('treats a missing or empty currency as USD', () => {
    const items = [{ price: 1, currency: '' }, { price: 2 }, { price: 3, currency: null }, { price: 4, currency: 'EUR' }]
    expect(sumByCurrency(items)).toEqual([
      { currency: 'EUR', amount: 4 },
      { currency: 'USD', amount: 6 },
    ])
  })

  it('skips items without a price and rounds to cents', () => {
    expect(sumByCurrency([{ price: null, currency: 'USD' }, { currency: 'EUR' }])).toEqual([])
    expect(sumByCurrency([{ price: 0.1, currency: 'USD' }, { price: 0.2, currency: 'USD' }])).toEqual([
      { currency: 'USD', amount: 0.3 },
    ])
  })
})

describe('totalLines', () => {
  it('shows one currency as a plain price', () => {
    expect(totalLines([{ currency: 'USD', amount: 1036.97 }])).toEqual(['$1,036.97'])
  })

  it('puts each currency on its own line when there are several', () => {
    expect(
      totalLines([
        { currency: 'USD', amount: 1036.97 },
        { currency: 'EUR', amount: 120 },
      ]),
    ).toEqual(['USD $1,036.97', 'EUR €120.00'])
  })

  it('falls back to the single total when there are no totals', () => {
    expect(totalLines(undefined, { amount: 50, currency: 'USD' })).toEqual(['$50.00'])
    expect(totalLines([], { amount: 50, currency: 'GBP' })).toEqual(['£50.00'])
  })

  it('has nothing to show for a mixed total without totals', () => {
    expect(totalLines([], { amount: null, currency: 'MIXED' })).toEqual([])
    expect(totalLines(undefined)).toEqual([])
  })
})
