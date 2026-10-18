import { formatPrice } from './api'

/** "Save $40.00 (20%)" for an alternative. */
export function savingsText(savings: number, pct: number, currency = 'USD'): string {
  return `Save ${formatPrice(savings, currency)} (${pct}%)`
}
