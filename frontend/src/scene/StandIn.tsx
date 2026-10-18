import { useEffect, useMemo } from 'react'
import { BoxGeometry, Color, CylinderGeometry, Mesh, MeshStandardMaterial, SRGBColorSpace, type BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { RoomObject } from '../types'
import { standInParts, type Part } from './standInShapes'

const GHOST_OPACITY = 0.15
const DARKEN = 0.5

function geometryOf({ kind, size: [sx, sy, sz], round }: Part): BufferGeometry {
  if (kind === 'cyl') {
    const g = new CylinderGeometry(sx / 2, sx / 2, sz, 24).rotateX(Math.PI / 2) // axis along z
    return g.scale(1, sy / sx, 1)
  }
  if (round) return new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(round, Math.min(sx, sy, sz) / 2 - 1e-4))
  return new BoxGeometry(sx, sy, sz)
}

/** A box-and-cylinder model for a piece with no mesh. Goes inside the room-frame (z-up) group. */
export default function StandIn({ obj }: { obj: RoomObject }) {
  const [r, g, b, a] = obj.rgba
  const ghost = !!obj.hidden
  const [w, d, h] = obj.size
  const shape = obj.shape ?? obj.label

  const parts = useMemo(() => standInParts(shape, [w, d, h]), [shape, w, d, h])
  const geoms = useMemo(() => parts.map(geometryOf), [parts])
  const [light, dark] = useMemo(() => {
    const make = (color: Color) =>
      new MeshStandardMaterial({
        color,
        opacity: ghost ? GHOST_OPACITY : a,
        transparent: ghost || a < 1,
        depthWrite: !ghost,
        roughness: 0.8,
      })
    const base = new Color().setRGB(r, g, b, SRGBColorSpace)
    return [make(base), make(base.clone().multiplyScalar(DARKEN))]
  }, [r, g, b, a, ghost])

  useEffect(() => () => geoms.forEach((x) => x.dispose()), [geoms])
  useEffect(() => () => [light, dark].forEach((m) => m.dispose()), [light, dark])

  return (
    <>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={geoms[i]}
          material={p.dark ? dark : light}
          position={p.pos}
          castShadow={!ghost}
          receiveShadow={!ghost}
          // Set the normal raycast back explicitly: R3F ignores undefined props, so an un-ghosted piece would stay unclickable.
          raycast={ghost ? () => null : Mesh.prototype.raycast}
        />
      ))}
    </>
  )
}
