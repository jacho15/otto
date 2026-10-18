import { describe, expect, it } from 'vitest'
import { customItemFor, ikeaButtonText, ikeaSavingsText, savingsText, sizeCmText } from './alternativesLogic'
import type { IkeaAlternative } from './types'

describe('savingsText', () => {
  it('shows the amount and the percent', () => {
    expect(savingsText(40, 20)).toBe('Save $40.00 (20%)')
  })

  it('uses the given currency', () => {
    expect(savingsText(12.5, 8, 'EUR')).toBe('Save €12.50 (8%)')
  })
})

describe('ikeaSavingsText', () => {
  it('matches the catalog text when there is a saving', () => {
    expect(ikeaSavingsText(10.5, 21, 'USD')).toBe('Save $10.50 (21%)')
  })

  it('is null without a price to compare with', () => {
    expect(ikeaSavingsText(null, null)).toBeNull()
  })
})

describe('sizeCmText', () => {
  it('rounds metres to whole centimetres', () => {
    expect(sizeCmText([0.6, 0.605, 0.8])).toBe('60 × 61 × 80 cm')
  })
})

describe('ikeaButtonText', () => {
  it('names the search by whether the piece has a price', () => {
    expect(ikeaButtonText(true, false)).toBe('Search IKEA for more')
    expect(ikeaButtonText(false, false)).toBe('Find similar at IKEA')
  })

  it('says it is searching while it waits', () => {
    expect(ikeaButtonText(true, true)).toBe('Searching IKEA…')
    expect(ikeaButtonText(false, true)).toBe('Searching IKEA…')
  })
})

describe('customItemFor', () => {
  const found: IkeaAlternative = {
    id: 'ikea-1a2b3c4d',
    title: 'GOOD chair',
    label: 'chair',
    url: 'https://www.ikea.com/us/en/p/good/',
    price: 40,
    currency: 'USD',
    size: [0.6, 0.6, 0.8],
    rgba: [0.7, 0.7, 0.7, 1],
    model: null,
    photo: null,
    source: 'ikea',
    catalog_id: null,
    image_url: 'https://www.ikea.com/images/x.jpg',
    similarity: 1,
    why: 'Same type, close size.',
    savings: 10.5,
    savings_pct: 21,
    fits: true,
    problems: [],
  }

  it('keeps what the custom item needs', () => {
    expect(customItemFor(found)).toEqual({
      title: 'GOOD chair',
      url: 'https://www.ikea.com/us/en/p/good/',
      price: 40,
      currency: 'USD',
      size: [0.6, 0.6, 0.8],
      label: 'chair',
      image_url: 'https://www.ikea.com/images/x.jpg',
    })
  })

  it('leaves out a missing price and photo', () => {
    const item = customItemFor({ ...found, price: null, image_url: null })
    expect(item).not.toHaveProperty('price')
    expect(item).not.toHaveProperty('image_url')
  })
})
