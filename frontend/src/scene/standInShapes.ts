// Procedural stand-ins for pieces that have no 3D model yet, built from boxes and cylinders.
// Frame is the room's: x = width, y = depth (front at -y, back at +y), z up from the floor.
// Every shape fills exactly [w, d, h] and is centred on the footprint.
import type { Vec3 } from '../types'

export interface Part {
  kind: 'box' | 'cyl'
  pos: Vec3 // centre
  size: Vec3 // a cylinder's diameters across x and y, then its height
  dark?: boolean // legs, poles and shelf lines
  round?: number // corner radius of a box
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function standInParts(label: string, [w, d, h]: Vec3): Part[] {
  const parts: Part[] = []
  // Extents are given from the front-left-bottom corner, so the sums are easy to check by eye.
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: Partial<Part> = {}) =>
    parts.push({ kind: 'box', pos: [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - d / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], ...o })
  const cyl = (cx: number, cy: number, z0: number, z1: number, dx: number, dy: number, o: Partial<Part> = {}) =>
    parts.push({ kind: 'cyl', pos: [cx - w / 2, cy - d / 2, (z0 + z1) / 2], size: [dx, dy, z1 - z0], ...o })
  const legs = (t: number, top: number, sides: ('left' | 'right')[] = ['left', 'right']) => {
    for (const side of sides) {
      const x0 = side === 'left' ? 0 : w - t
      box(x0, 0, 0, x0 + t, t, top, { dark: true })
      box(x0, d - t, 0, x0 + t, d, top, { dark: true })
    }
  }

  const name = label.toLowerCase()
  const pad = Math.min(w, d)
  if (name.includes('sofa') || name.includes('loveseat') || name.includes('armchair')) {
    // seat base, backrest along +y and an arm on each side
    const arm = clamp(w * (name.includes('armchair') ? 0.16 : 0.1), 0.06, 0.2)
    const foot = Math.min(0.08, h * 0.12)
    const seat = h * 0.45
    const back = Math.min(d * 0.28, 0.25)
    box(arm, 0, foot, w - arm, d, seat, { round: 0.03 })
    box(arm, d - back, seat, w - arm, d, h, { round: 0.04 })
    box(0, 0, foot, arm, d, h * 0.65, { round: 0.04 })
    box(w - arm, 0, foot, w, d, h * 0.65, { round: 0.04 })
    legs(Math.min(0.05, w * 0.05), foot)
  } else if (name.includes('chair')) {
    const seat = h * 0.5
    const t = Math.min(0.05, h * 0.1)
    const back = Math.min(0.04, d * 0.12)
    const disc = Math.min(0.04, h * 0.05)
    const post = clamp(pad * 0.1, 0.03, 0.06)
    box(0, 0, seat - t, w, d, seat, { round: 0.015 })
    box(0, d - back, seat, w, d, h, { round: 0.015 })
    cyl(w / 2, d / 2, disc, seat - t, post, post, { dark: true })
    cyl(w / 2, d / 2, 0, disc, pad * 0.8, pad * 0.8, { dark: true })
  } else if (name.includes('desk')) {
    const t = Math.min(0.04, h * 0.08)
    box(0, 0, h - t, w, d, h)
    box(0, 0, 0, t, d, h - t) // side panel on the left
    legs(Math.min(0.05, w * 0.05), h - t, ['right'])
  } else if (name.includes('table')) {
    const t = Math.min(0.04, h * 0.12)
    if (name.includes('round')) {
      // round: a disc top on a pedestal
      const stem = clamp(pad * 0.15, 0.04, 0.12)
      cyl(w / 2, d / 2, h - t, h, w, d)
      cyl(w / 2, d / 2, 0.02, h - t, stem, stem, { dark: true })
      cyl(w / 2, d / 2, 0, 0.02, pad * 0.5, pad * 0.5, { dark: true })
    } else {
      box(0, 0, h - t, w, d, h)
      legs(Math.min(0.05, pad * 0.1), h - t)
    }
  } else if (name.includes('bookcase') || name.includes('bookshelf')) {
    // shelf lines stand a hair proud of the front face
    const lip = 0.012
    box(0, lip, 0, w, d, h)
    for (let i = 0; i <= 5; i++) {
      const z = clamp((h * i) / 5, 0.01, h - 0.01)
      box(0, 0, z - 0.01, w, lip, z + 0.01, { dark: true })
    }
  } else if (name.includes('lamp')) {
    const base = Math.min(0.03, h * 0.04)
    const pole = Math.max(0.015, pad * 0.06)
    cyl(w / 2, d / 2, 0, base, w * 0.6, d * 0.6, { dark: true })
    cyl(w / 2, d / 2, base, h * 0.8, pole, pole, { dark: true })
    cyl(w / 2, d / 2, h * 0.75, h, w, d)
  } else {
    box(0, 0, 0, w, d, h, { round: Math.min(w, d, h) * 0.15 })
  }
  return parts
}
