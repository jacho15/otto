import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import { MeshStandardMaterial, type Mesh } from 'three'
import { roomToThree } from '../geometry'
import type { Vec3 } from '../types'

export interface DemoPiece {
  name: string
  mesh: string
  pos: Vec3
  yaw: number
}

/** The reconstructed pieces on a plain floor, turning slowly. Drag to look around. */
export default function DemoRoom({ base, pieces }: { base: string; pieces: DemoPiece[] }) {
  return (
    <Canvas camera={{ position: [4, 3.2, 4], fov: 35 }} dpr={[1, 2]} shadows>
      <hemisphereLight args={['#ffffff', '#cfd6d2', 1.3]} />
      <directionalLight position={[3, 6, 2]} intensity={1.8} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.1}>
          <group>
            {pieces.map((p) => (
              <Piece key={p.name} url={`${base}/${p.mesh}`} pos={p.pos} yaw={p.yaw} />
            ))}
          </group>
        </Bounds>
      </Suspense>
      <mesh rotation-x={-Math.PI / 2} position={[1.7, -0.001, -0.6]} receiveShadow>
        <circleGeometry args={[2.7, 64]} />
        <meshStandardMaterial color="#e3e7e4" roughness={1} />
      </mesh>
      <OrbitControls autoRotate autoRotateSpeed={0.8} enablePan={false} enableZoom={false} maxPolarAngle={Math.PI / 2 - 0.1} makeDefault />
    </Canvas>
  )
}

function Piece({ url, pos, yaw }: { url: string; pos: Vec3; yaw: number }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      // Reconstructed meshes carry per-vertex colour but no normals.
      const flat = !mesh.geometry.attributes.normal
      if (flat) mesh.geometry.computeVertexNormals()
      mesh.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: flat })
      mesh.castShadow = true
    })
    return root
  }, [scene])
  return (
    <group position={roomToThree([pos[0], pos[1], 0])} rotation-y={yaw}>
      {/* mesh files are z-up; three.js is y-up */}
      <primitive object={model} rotation-x={-Math.PI / 2} />
    </group>
  )
}
