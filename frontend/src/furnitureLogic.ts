// Pure helpers for the "Add any furniture" card: sizes in cm or inches, files, and what was dropped on the 3D view.
import type { Vec3 } from './types'

export type SizeUnit = 'cm' | 'in'
export type Dim = 'width' | 'depth' | 'height'
export type FileKind = 'photo' | 'model'

/** Types the user can choose from; each one has a stand-in shape. */
export const LABELS = ['sofa', 'armchair', 'chair', 'desk', 'table', 'coffee table', 'side table', 'bookcase', 'lamp']

const CM_PER_IN = 2.54
const LIMITS_CM: Record<Dim, { label: string; min: number; max: number }> = {
  width: { label: 'Width', min: 5, max: 600 },
  depth: { label: 'Depth', min: 5, max: 600 },
  height: { label: 'Height', min: 5, max: 350 },
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_MODEL_BYTES = 25 * 1024 * 1024

const round1 = (v: number) => Math.round(v * 10) / 10

/** A length in metres as it is typed in the chosen unit, to 0.1. */
export function fromMetres(m: number, unit: SizeUnit): number {
  return round1(unit === 'in' ? m / (CM_PER_IN / 100) : m * 100)
}

/** A typed length in the chosen unit, in metres rounded to 1 mm. */
export function toMetres(value: number, unit: SizeUnit): number {
  return Math.round((unit === 'in' ? value * CM_PER_IN : value) * 10) / 1000
}

/** Convert typed text to the other unit, leaving anything that is not a number as it is. */
export function convertText(text: string, from: SizeUnit, to: SizeUnit): string {
  const v = Number(text)
  if (from === to || text.trim() === '' || !Number.isFinite(v)) return text
  return String(fromMetres(toMetres(v, from), to))
}

export function rangeText(dim: Dim, unit: SizeUnit): string {
  const { min, max } = LIMITS_CM[dim]
  const fmt = (cm: number) => (unit === 'in' ? (cm / CM_PER_IN).toFixed(1) : String(cm))
  return `${fmt(min)}–${fmt(max)} ${unit}`
}

/** Check width, depth and height typed in the chosen unit. Returns metres, or an error message. */
export function checkSize(
  texts: [string, string, string],
  unit: SizeUnit,
): { size: Vec3 } | { error: string } {
  const dims: Dim[] = ['width', 'depth', 'height']
  const size: number[] = []
  for (let i = 0; i < 3; i++) {
    const { label, min, max } = LIMITS_CM[dims[i]]
    const value = Number(texts[i])
    if (texts[i].trim() === '' || !Number.isFinite(value)) return { error: `${label} must be a number.` }
    const metres = toMetres(value, unit)
    // A little slack, so a limit typed in inches is not refused over rounding.
    if (metres * 100 < min - 0.05 || metres * 100 > max + 0.05) {
      return { error: `${label} must be between ${rangeText(dims[i], unit)}.` }
    }
    size.push(Math.min(max / 100, Math.max(min / 100, metres)))
  }
  return { size: size as Vec3 }
}

/** Empty is no price. Otherwise a number of 0 or more, or undefined when invalid. */
export function parsePrice(text: string): number | null | undefined {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

type FileLike = { name: string; type: string }

export function fileKind(f: FileLike): FileKind | null {
  const name = f.name.toLowerCase()
  if (/^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/.test(name)) return 'photo'
  if (/\.(glb|obj|stl|ply)$/.test(name)) return 'model'
  return null
}

/** An error message when the file is the wrong kind or too big, otherwise null. */
export function checkFile(kind: FileKind, f: FileLike & { size: number }): string | null {
  if (fileKind(f) !== kind) return kind === 'photo' ? 'Choose a JPEG, PNG or WebP photo.' : 'Choose a .glb, .obj, .stl or .ply file.'
  if (kind === 'photo' && f.size > MAX_IMAGE_BYTES) return 'The photo must be 5 MB or smaller.'
  if (kind === 'model' && f.size > MAX_MODEL_BYTES) return 'The model must be 25 MB or smaller.'
  return null
}

/** "green-sofa_v2.glb" -> "green sofa v2" */
export function titleFromFile(name: string): string {
  return name.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').trim()
}

/** The first plain http(s) link in a dropped uri list, or in dropped text. */
export function linkFrom(uriList: string, text: string): string | null {
  const lines = [...uriList.split(/\r?\n/).filter((l) => !l.startsWith('#')), text]
  return lines.map((l) => l.trim()).find((l) => /^https?:\/\/\S+$/i.test(l)) ?? null
}

export type DropIntent<F extends FileLike = File> =
  | { kind: 'link'; url: string }
  | { kind: FileKind; file: F }

/** What a drop on the 3D view means: a photo, a 3D model file or a link, or null for anything else. */
export function dropIntent<F extends FileLike>(files: F[], uriList: string, text: string): DropIntent<F> | null {
  for (const file of files) {
    const kind = fileKind(file)
    if (kind) return { kind, file }
  }
  const url = linkFrom(uriList, text)
  return url ? { kind: 'link', url } : null
}
