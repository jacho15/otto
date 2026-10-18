// Fits an uploaded glTF model (y-up, any units, anywhere in space) to a size in metres.
import type { Vec3 } from '../types'

export interface Bounds {
  min: Vec3
  max: Vec3
}

/**
 * For a bounding box in glTF space (x = width, y = height, z = depth) and a target size [w, d, h]:
 * the scale that stretches it to exactly that size, and the position that centres its footprint
 * on the origin with its base at 0. Apply both to one group around the model: p -> position + scale * p.
 */
export function fitTransform({ min, max }: Bounds, [w, d, h]: Vec3): { scale: Vec3; position: Vec3 } {
  const fit = (target: number, lo: number, hi: number) => (hi - lo > 1e-9 ? target / (hi - lo) : 1)
  const scale: Vec3 = [fit(w, min[0], max[0]), fit(h, min[1], max[1]), fit(d, min[2], max[2])]
  return {
    scale,
    position: [-((min[0] + max[0]) / 2) * scale[0], -min[1] * scale[1], -((min[2] + max[2]) / 2) * scale[2]],
  }
}
