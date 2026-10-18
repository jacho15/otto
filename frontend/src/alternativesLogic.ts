import { formatPrice } from './api'
import type { IkeaAlternative, NewCustomItem, Vec3 } from './types'

/** "Save $40.00 (20%)" for an alternative. */
export function savingsText(savings: number, pct: number, currency = 'USD'): string {
  return `Save ${formatPrice(savings, currency)} (${pct}%)`
}

/** "Save $40.00 (20%)", or null when there is no price to save against. */
export function ikeaSavingsText(savings: number | null, pct: number | null, currency = 'USD'): string | null {
  return savings === null || pct === null ? null : savingsText(savings, pct, currency)
}

/** "60 × 60 × 80 cm" (width, depth, height) from a size in metres. */
export function sizeCmText(size: Vec3): string {
  return `${size.map((m) => Math.round(m * 100)).join(' × ')} cm`
}

/** The label of the IKEA search button. */
export function ikeaButtonText(hasPrice: boolean, searching: boolean): string {
  if (searching) return 'Searching IKEA…'
  return hasPrice ? 'Search IKEA for more' : 'Find similar at IKEA'
}

/** The custom item to save before an IKEA piece is swapped in. A missing photo or price is left out. */
export function customItemFor(a: IkeaAlternative): NewCustomItem {
  const item: NewCustomItem = { title: a.title, url: a.url, currency: a.currency, size: a.size, label: a.label }
  if (a.price !== null) item.price = a.price
  if (a.image_url) item.image_url = a.image_url
  return item
}
