import { describe, expect, it } from 'vitest'
import {
  customItemFor,
  estimatedSizeText,
  ikeaButtonText,
  ikeaSavingsText,
  lookText,
  savingsText,
  shopButtonText,
  shopLinkText,
  sizeCmText,
} from './alternativesLogic'
import type { IkeaAlternative, ShopAlternative } from './types'

describe('lookText', () => {
  it('says how much it looks like the piece', () => {
    expect(lookText(0.95)).toBe('Looks very similar')
    expect(lookText(0.8)).toBe('Looks very similar')
    expect(lookText(0.6)).toBe('Looks similar')
  })

  it('says nothing when it was not judged', () => {
    expect(lookText(null)).toBeNull()
  })
})

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
    look: 0.8,
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
    expect(item).not.toHaveProperty('price_source')
  })
})

describe('estimatedSizeText', () => {
  it('says the size is a guess', () => {
    expect(estimatedSizeText([1.55, 0.9, 0.85])).toBe('about 155 × 90 × 85 cm (estimated)')
  })

  it('rounds metres to whole centimetres', () => {
    expect(estimatedSizeText([0.6, 0.605, 0.8])).toBe('about 60 × 61 × 80 cm (estimated)')
  })
})

describe('shopButtonText', () => {
  it('names the search and shows it is waiting', () => {
    expect(shopButtonText(false)).toBe('Search other shops')
    expect(shopButtonText(true)).toBe('Searching other shops…')
  })
})

describe('shopLinkText', () => {
  it('names Google Shopping for a Google link', () => {
    expect(shopLinkText('https://www.google.com/shopping/product/1', 'Target')).toBe('View on Google Shopping')
  })

  it('names the shop for any other link', () => {
    expect(shopLinkText('https://www.wayfair.com/loveseat', 'Wayfair')).toBe('View at Wayfair')
  })
})

describe('customItemFor a shop piece', () => {
  const found: ShopAlternative = {
    id: 'shop-1a2b3c4d',
    title: 'Gray loveseat',
    label: 'loveseat',
    url: 'https://www.wayfair.com/loveseat',
    price: 299.99,
    currency: 'USD',
    size: [1.55, 0.85, 0.85],
    rgba: [0.7, 0.7, 0.7, 1],
    model: null,
    photo: null,
    source: 'shop',
    catalog_id: null,
    image_url: 'https://encrypted-tbn0.gstatic.com/x.jpg',
    similarity: 0.9,
    why: 'A loveseat, size from the title.',
    look: null,
    savings: 100,
    savings_pct: 25,
    shop: 'Wayfair',
    size_estimated: true,
    price_note: 'Listed price on Wayfair. Size is estimated from the listing.',
    fits: true,
    problems: [],
  }

  it('marks the price as a listing price', () => {
    expect(customItemFor(found)).toEqual({
      title: 'Gray loveseat',
      url: 'https://www.wayfair.com/loveseat',
      price: 299.99,
      currency: 'USD',
      size: [1.55, 0.85, 0.85],
      label: 'loveseat',
      image_url: 'https://encrypted-tbn0.gstatic.com/x.jpg',
      price_source: 'listing',
    })
  })

  it('leaves out a missing photo', () => {
    expect(customItemFor({ ...found, image_url: null })).not.toHaveProperty('image_url')
  })
})
