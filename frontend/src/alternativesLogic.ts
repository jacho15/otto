import { formatPrice } from './api'
import { isGoogleUrl } from './checkoutLogic'
import type { IkeaAlternative, NewCustomItem, ShopAlternative, Vec3 } from './types'

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

/** "about 155 × 90 × 85 cm (estimated)" for a size that was guessed from a listing. */
export function estimatedSizeText(size: Vec3): string {
  return `about ${size.map((m) => Math.round(m * 100)).join(' × ')} cm (estimated)`
}

/** "Looks very similar" or "Looks similar" from the look score of an alternative. null when it was not judged. */
export function lookText(look: number | null | undefined): string | null {
  if (look == null) return null
  return look >= 0.8 ? 'Looks very similar' : 'Looks similar'
}

/** The label of the IKEA search button. */
export function ikeaButtonText(hasPrice: boolean, searching: boolean): string {
  if (searching) return 'Searching IKEA…'
  return hasPrice ? 'Search IKEA for more' : 'Find similar at IKEA'
}

/** The label of the other shops search button. */
export const shopButtonText = (searching: boolean) => (searching ? 'Searching other shops…' : 'Search other shops')

/** The text of a shop card's link: "View on Google Shopping" for a Google link, else "View at <shop>". */
export const shopLinkText = (url: string, shop: string): string =>
  isGoogleUrl(url) ? 'View on Google Shopping' : `View at ${shop}`

/** The custom item to save before an IKEA or shop piece is swapped in. A missing photo or price is left out.
 * A shop price is the listed one, so the item says so. */
export function customItemFor(a: IkeaAlternative | ShopAlternative): NewCustomItem {
  const item: NewCustomItem = { title: a.title, url: a.url, currency: a.currency, size: a.size, label: a.label }
  if (a.price !== null) item.price = a.price
  if (a.image_url) item.image_url = a.image_url
  if (a.source === 'shop') item.price_source = 'listing'
  return item
}
