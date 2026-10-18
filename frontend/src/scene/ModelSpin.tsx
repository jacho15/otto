import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import { MeshStandardMaterial, type Mesh } from 'three'

/** One reconstructed piece on its own, slowly turning: drag to look around. */
export default function ModelSpin({ url, label }: { url: string; label: string }) {
  return (
    <div className="model-spin" role="img" aria-label={`3D model of the ${label}`}>
      <Canvas camera={{ position: [1.6, 1.1, 1.6], fov: 35 }} dpr={[1, 2]}>
        <color attach="background" args={['#F7F4EF']} />
        <hemisphereLight args={['#ffffff', '#d9cfbf', 1.4]} />
        <directionalLight position={[2, 3, 2]} intensity={1.6} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.15}>
            <Model url={url} />
          </Bounds>
        </Suspense>
        <OrbitControls autoRotate autoRotateSpeed={1.2} enablePan={false} enableZoom={false} makeDefault />
      </Canvas>
    </div>
  )
}

function Model({ url }: { url: string }) {
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
    })
    return root
  }, [scene])
  // mesh files are z-up; three.js is y-up
  return <primitive object={model} rotation-x={-Math.PI / 2} />
}
