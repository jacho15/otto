import { formatPrice } from './api'
import type { Money, Total } from './types'

/** Sums priced items per currency, sorted by currency code. A missing currency counts as USD. Items without a price are skipped. */
export function sumByCurrency(items: { price?: number | null; currency?: string | null }[]): Money[] {
  const sums = new Map<string, number>()
  for (const i of items) {
    if (i.price == null) continue
    const currency = i.currency || 'USD'
    sums.set(currency, (sums.get(currency) ?? 0) + i.price)
  }
  return [...sums]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
}

/**
 * One line per currency. A single currency reads as a plain price ("$1,036.97"); several get a code
 * in front ("USD $1,036.97", "EUR €120.00"). With no `totals`, falls back to `total` unless that is mixed.
 */
export function totalLines(totals: Money[] | undefined, total?: Total): string[] {
  if (!totals || totals.length === 0) {
    return total && total.amount != null ? [formatPrice(total.amount, total.currency)] : []
  }
  if (totals.length === 1) return [formatPrice(totals[0].amount, totals[0].currency)]
  return totals.map((t) => `${t.currency} ${formatPrice(t.amount, t.currency)}`)
}
