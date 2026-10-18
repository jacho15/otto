// Pure helpers for room <-> three.js coordinates and footprint checks.
// Room frame: z-up, floor at z=0, origin at room centre, metres.
// three.js frame: y-up. Room (x, y, z) -> three (x, z, -y); room yaw = three rotation.y.
import type { RoomObject, Vec2, Vec3, Warning } from './types'

export const TOL = 0.001 // 1 mm

export function roomToThree([x, y, z]: Vec3): Vec3 {
  return [x, z, -y]
}

export function threeToRoom([x, y, z]: Vec3): Vec3 {
  return [x, -z, y]
}

/** Corners of the w x d footprint centred at pos, rotated counter-clockwise by yaw. */
export function footprintCorners(pos: Vec2 | Vec3, size: Vec2 | Vec3, yaw: number): Vec2[] {
  const hw = size[0] / 2
  const hd = size[1] / 2
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const local: Vec2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
  return local.map(([lx, ly]) => [pos[0] + lx * c - ly * s, pos[1] + lx * s + ly * c])
}

function axes(corners: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < 2; i++) {
    const ex = corners[i + 1][0] - corners[i][0]
    const ey = corners[i + 1][1] - corners[i][1]
    const n = Math.hypot(ex, ey)
    if (n > 0) out.push([-ey / n, ex / n])
  }
  return out
}

function project(corners: Vec2[], axis: Vec2): Vec2 {
  const vals = corners.map(([x, y]) => x * axis[0] + y * axis[1])
  return [Math.min(...vals), Math.max(...vals)]
}

/** Separating axis test. Overlap depth of tol or less counts as touching. */
export function footprintsOverlap(a: Vec2[], b: Vec2[], tol = TOL): boolean {
  for (const axis of [...axes(a), ...axes(b)]) {
    const [amin, amax] = project(a, axis)
    const [bmin, bmax] = project(b, axis)
    if (Math.min(amax, bmax) - Math.max(amin, bmin) <= tol) return false
  }
  return true
}

/** True if any corner is outside the interior floor by more than tol. */
export function outsideWalls(corners: Vec2[], sizeXY: Vec2, tol = TOL): boolean {
  const hx = sizeXY[0] / 2
  const hy = sizeXY[1] / 2
  return corners.some(([x, y]) => Math.abs(x) > hx + tol || Math.abs(y) > hy + tol)
}

export function findWarnings(all: RoomObject[], sizeXY: Vec2): Warning[] {
  const objects = all.filter((o) => !o.hidden) // ghosts take no space
  const corners = new Map(objects.map((o) => [o.name, footprintCorners(o.pos, o.size, o.yaw)]))
  const warnings: Warning[] = []
  objects.forEach((a, i) => {
    for (const b of objects.slice(i + 1)) {
      if (footprintsOverlap(corners.get(a.name)!, corners.get(b.name)!)) {
        warnings.push({ type: 'overlap', objects: [a.name, b.name] })
      }
    }
  })
  for (const o of objects) {
    if (outsideWalls(corners.get(o.name)!, sizeXY)) warnings.push({ type: 'wall', object: o.name })
  }
  return warnings
}

export function warnedNames(warnings: Warning[]): Set<string> {
  const names = new Set<string>()
  for (const w of warnings) {
    if (w.type === 'overlap') w.objects.forEach((n) => names.add(n))
    else names.add(w.object)
  }
  return names
}

export interface WallGaps {
  '+x': number
  '-x': number
  '+y': number
  '-y': number
}

/** Clear distance from a footprint to each wall; negative means it pokes through. */
export function wallGaps(corners: Vec2[], sizeXY: Vec2): WallGaps {
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const hx = sizeXY[0] / 2
  const hy = sizeXY[1] / 2
  return {
    '+x': hx - Math.max(...xs),
    '-x': hx + Math.min(...xs),
    '+y': hy - Math.max(...ys),
    '-y': hy + Math.min(...ys),
  }
}

export interface Gap {
  gap: number
  from: Vec2 // closest point on a
  to: Vec2 // closest point on b
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}

/** Shortest distance between two footprints and the closest point on each. Zero if they overlap. */
export function footprintGap(a: Vec2[], b: Vec2[]): Gap {
  if (footprintsOverlap(a, b, 0)) return { gap: 0, from: a[0], to: a[0] }
  let best: Gap = { gap: Infinity, from: a[0], to: b[0] }
  const edges = (c: Vec2[]) => c.map((p, i) => [p, c[(i + 1) % c.length]] as [Vec2, Vec2])
  // Between disjoint convex polygons the closest pair always includes a corner of one of them.
  for (const [from, c, swap] of [[a, b, false], [b, a, true]] as const) {
    for (const p of from) {
      for (const [e0, e1] of edges(c)) {
        const q = closestOnSegment(p, e0, e1)
        const gap = Math.hypot(p[0] - q[0], p[1] - q[1])
        if (gap < best.gap) best = swap ? { gap, from: q, to: p } : { gap, from: p, to: q }
      }
    }
  }
  return best
}

export const SNAP_DISTANCE = 0.12 // m
export const WALKWAY = 0.6 // m

/** A gap you can see but not comfortably walk through. */
export function isTight(gap: number): boolean {
  return gap > 0 && gap < WALKWAY
}

/** Shift a footprint centred at pos flush against any wall it is within `dist` of, each axis on its own. */
export function snapToWalls(pos: Vec2, size: Vec2 | Vec3, yaw: number, sizeXY: Vec2, dist = SNAP_DISTANCE): Vec2 {
  const c = Math.abs(Math.cos(yaw))
  const s = Math.abs(Math.sin(yaw))
  const ext: Vec2 = [(c * size[0] + s * size[1]) / 2, (s * size[0] + c * size[1]) / 2]
  const out: Vec2 = [pos[0], pos[1]]
  for (const i of [0, 1]) {
    const half = sizeXY[i] / 2
    const gapHigh = half - (pos[i] + ext[i])
    const gapLow = half + (pos[i] - ext[i])
    if (Math.abs(gapHigh) > dist && Math.abs(gapLow) > dist) continue
    out[i] = Math.abs(gapHigh) <= Math.abs(gapLow) ? half - ext[i] : -half + ext[i]
  }
  return out
}

/** Metres as "1.25 m", or "35 cm" under a metre. */
export function formatDistance(m: number): string {
  return Math.abs(m) >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`
}
