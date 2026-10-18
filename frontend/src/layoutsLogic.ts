import type { Layout } from './types'

/** Id of the layout with the lowest total, or null when there is nothing to compare. Ties go to the first. */
export function cheapestId(layouts: Layout[]): string | null {
  if (layouts.length < 2) return null
  return layouts.reduce((best, l) => (l.total.amount < best.total.amount ? l : best)).id
}
