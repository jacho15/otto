import { ApiError, formatPrice } from './api'
import type { Mandate, Order, OrderItem } from './types'

/** Currencies the spend mandate can be set in. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'SEK']

/** "ikea.com, IKEA.com ," -> ["ikea.com"] */
export function parseShops(text: string): string[] {
  const shops = text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return [...new Set(shops)]
}

/** A local YYYY-MM-DD, `days` after `from`. */
export function defaultExpiry(from = new Date(), days = 7): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Empty -> null (no limit). Otherwise a number of 0 or more, or undefined when invalid. */
export function parseLimit(text: string): number | null | undefined {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function mandateSummary(m: Mandate): string[] {
  const currency = m.currency ?? 'USD'
  return [
    m.max_item_price == null ? 'No limit per item' : `Up to ${formatPrice(m.max_item_price, currency)} per item`,
    m.max_total == null ? 'No limit per order' : `Up to ${formatPrice(m.max_total, currency)} per order`,
    `Shops: ${m.shops.join(', ')}`,
    m.expires ? `Expires ${m.expires}` : 'No expiry',
  ]
}

export const tokenLabel = (last4: string) => `Agent token •••• ${last4}`

/** Object names that are part of an approved order. */
export function orderedNames(orders: Order[]): Set<string> {
  return new Set(orders.filter((o) => o.status === 'approved').flatMap((o) => o.items.map((i) => i.object_name)))
}

/** The server's message when it sent a string detail, otherwise the error's own message. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && typeof e.detail === 'string') return e.detail
  return e instanceof Error ? e.message : 'Something went wrong.'
}

/** Violations from a 409 approve response, or null for any other error. */
export function violationsOf(e: unknown): string[] | null {
  if (!(e instanceof ApiError) || typeof e.detail !== 'object' || e.detail === null) return null
  const v = (e.detail as { violations?: unknown }).violations
  return Array.isArray(v) ? v.map(String) : null
}

/** Host of a plain http(s) link without www., or null. Mirrors the server's shop check. */
function shopHost(url: string): string | null {
  try {
    const u = new URL(url.trim().replace(/\\/g, '/'))
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null
    return u.hostname.replace(/\.$/, '').replace(/^www\./, '')
  } catch {
    return null
  }
}

function allowedShop(url: string, shops: string[]): boolean {
  const host = shopHost(url)
  if (!host) return false
  return shops.some((s) => {
    const shop = s.includes('://') ? shopHost(s) : s.trim().toLowerCase().replace(/^www\./, '')
    return !!shop && (host === shop || host.endsWith(`.${shop}`))
  })
}

/** Reasons the order's items break the mandate right now. Empty when they fit. The server decides on approve. */
export function currentViolations(items: OrderItem[], mandate: Mandate, today = new Date()): string[] {
  const problems: string[] = []
  if (mandate.expires && defaultExpiry(today, 0) > mandate.expires) problems.push(`The mandate expired on ${mandate.expires}.`)
  const currency = mandate.currency || 'USD'
  const counted: OrderItem[] = []
  for (const i of items) {
    if ((i.currency || 'USD') === currency) counted.push(i)
    else problems.push(`${i.title}: Price is in ${i.currency || 'USD'}; your limits are in ${currency}.`)
  }
  if (mandate.max_item_price != null) {
    for (const i of counted) {
      if (i.price > mandate.max_item_price) {
        problems.push(`${i.title} costs ${formatPrice(i.price, currency)}, over the per-item limit of ${formatPrice(mandate.max_item_price, currency)}.`)
      }
    }
  }
  const total = counted.reduce((sum, i) => sum + i.price, 0)
  if (mandate.max_total != null && Math.round(total * 100) / 100 > mandate.max_total) {
    problems.push(`The total ${formatPrice(total, currency)} is over the limit of ${formatPrice(mandate.max_total, currency)}.`)
  }
  if (mandate.shops.length > 0) {
    for (const i of items) if (!allowedShop(i.url, mandate.shops)) problems.push(`${i.title} is not from an allowed shop.`)
  }
  return problems
}
