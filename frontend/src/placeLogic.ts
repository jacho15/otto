export type Unit = 'm' | 'ft'

const M_PER_FT = 0.3048

export const LIMITS = {
  width: { label: 'Width', min: 1.5, max: 15 },
  depth: { label: 'Depth', min: 1.5, max: 15 },
  height: { label: 'Ceiling height', min: 2, max: 4 },
  doorWidth: { label: 'Door width', min: 0.5, max: 2 },
  doorHeight: { label: 'Door height', min: 1.5, max: 3 },
} as const

export type Dim = keyof typeof LIMITS

/** Convert a length in the chosen unit to metres, rounded to 1 mm. */
export function toMetres(value: number, unit: Unit): number {
  const m = unit === 'ft' ? value * M_PER_FT : value
  return Math.round(m * 1000) / 1000
}

export function fromMetres(m: number, unit: Unit): number {
  const v = unit === 'ft' ? m / M_PER_FT : m
  return Math.round(v * 100) / 100
}

/** The allowed range of a dimension in the chosen unit, as shown to the user. */
export function rangeText(dim: Dim, unit: Unit): string {
  const { min, max } = LIMITS[dim]
  const fmt = (m: number) => (unit === 'ft' ? fromMetres(m, 'ft').toFixed(1) : String(m))
  return `${fmt(min)}–${fmt(max)} ${unit}`
}

/**
 * Check one typed dimension against its range in the chosen unit.
 * Returns the value in metres, or an error message.
 */
export function checkDimension(dim: Dim, text: string, unit: Unit): { metres: number } | { error: string } {
  const { label, min, max } = LIMITS[dim]
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) return { error: `${label} must be a number.` }
  const metres = toMetres(value, unit)
  // Compare in metres with a tiny slack so 4.9 ft-style rounding at the edges is accepted.
  if (metres < min - 0.005 || metres > max + 0.005) {
    return { error: `${label} must be between ${rangeText(dim, unit)}.` }
  }
  return { metres: Math.min(max, Math.max(min, metres)) }
}
