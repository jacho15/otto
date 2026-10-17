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

export function findWarnings(objects: RoomObject[], sizeXY: Vec2): Warning[] {
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

/** Metres as "1.25 m", or "35 cm" under a metre. */
export function formatDistance(m: number): string {
  return Math.abs(m) >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`
}
