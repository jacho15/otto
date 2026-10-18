// A short walk-around for videos of a room: a camera at standing eye height sweeps around one piece,
// starting from the open side of the room and always staying inside the walls.
import { roomToThree } from '../geometry'
import type { Vec2, Vec3 } from '../types'

export const TOUR_MS = 6000
const EYE = 1.5 // metres: standing eye height
const SWEEP = (110 * Math.PI) / 180 // the arc the camera walks
const MARGIN = 0.25 // metres kept from the walls

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** Camera position and look-at point (three.js coordinates) at progress t, 0 to 1. */
export function tourPose(t: number, sizeXY: Vec2, piecePos: Vec2 | Vec3, pieceSize: Vec3): { position: Vec3; target: Vec3 } {
  const [cx, cy] = piecePos
  const hx = sizeXY[0] / 2 - MARGIN
  const hy = sizeXY[1] / 2 - MARGIN
  // face the piece from the room's middle, where there is space to stand
  const toCentre = Math.hypot(cx, cy) > 0.1 ? Math.atan2(-cy, -cx) : -Math.PI / 2
  const a = toCentre + (ease(Math.min(1, Math.max(0, t))) - 0.5) * SWEEP
  const r = Math.min(3.2, Math.max(1.4, 1.2 + Math.max(pieceSize[0], pieceSize[1]) * 0.8))
  const x = Math.min(hx, Math.max(-hx, cx + r * Math.cos(a)))
  const y = Math.min(hy, Math.max(-hy, cy + r * Math.sin(a)))
  return {
    position: roomToThree([x, y, EYE]),
    target: roomToThree([cx, cy, Math.min(1, pieceSize[2] * 0.55)]),
  }
}
