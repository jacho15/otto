import type { Layout } from './types'

/**
 * Id of the layout with the lowest total, or null when there is nothing to compare. Ties go to the first.
 * Totals in different currencies cannot be compared, so then there is no cheapest.
 */
export function cheapestId(layouts: Layout[]): string | null {
  if (layouts.length < 2) return null
  const first = layouts[0].total.currency
  if (layouts.some((l) => l.total.amount == null || l.total.currency !== first)) return null
  return layouts.reduce((best, l) => (l.total.amount! < best.total.amount! ? l : best)).id
}
