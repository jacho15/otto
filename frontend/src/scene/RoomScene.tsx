import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Lightformer, Line, OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Material,
  type Ray,
} from 'three'
import { meshUrl } from '../api'
import { footprintCorners, roomToThree, threeToRoom } from '../geometry'
import type { Room, RoomObject, Vec2, Vec3 } from '../types'

const ACCENT = '#2F5D50'
const WARN = '#C2412D'
const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0)

interface Props {
  room: Room
  objects: RoomObject[]
  selected: string | null
  warned: Set<string>
  dragging: boolean
  onSelect: (name: string | null) => void
  onDragStart: (name: string) => void
  onDrag: (name: string, pos: Vec2) => void
  onDragEnd: (name: string, pos: Vec2 | null) => void
}

interface Drag {
  name: string
  offset: Vec2
  last: Vec2 | null
}

/** Room-frame (x, y) where a ray hits the floor, or null. */
function floorHit(ray: Ray): Vec2 | null {
  const p = ray.intersectPlane(FLOOR_PLANE, new Vector3())
  if (!p) return null
  const [x, y] = threeToRoom([p.x, p.y, p.z])
  return [x, y]
}

export default function RoomScene(props: Props) {
  const { room, objects, selected, warned, dragging, onSelect } = props
  const [W, D] = room.room.size_xy
  const span = Math.max(W, D)
  const drag = useRef<Drag | null>(null)

  const startDrag = (obj: RoomObject, e: ThreeEvent<PointerEvent>) => {
    const hit = floorHit(e.ray)
    if (!hit) return
    drag.current = { name: obj.name, offset: [obj.pos[0] - hit[0], obj.pos[1] - hit[1]], last: null }
    props.onDragStart(obj.name)
  }

  return (
    <>
      <Canvas
        shadows
        camera={{ position: [span * 0.8, span * 1.0, span * 1.1], fov: 45, near: 0.05, far: 100 }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#F7F4EF']} />
        <hemisphereLight args={['#ffffff', '#d9cfbf', 0.5]} />
        <directionalLight
          position={[span * 0.6, span * 1.4, span * 0.8]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
          shadow-camera-left={-span}
          shadow-camera-right={span}
          shadow-camera-top={span}
          shadow-camera-bottom={-span}
        />
        <Environment resolution={128}>
          <Lightformer intensity={1.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
          <Lightformer intensity={0.6} color="#fff3e0" position={[5, 2, 0]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} />
          <Lightformer intensity={0.4} position={[-5, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} />
        </Environment>

        <mesh
          rotation-x={-Math.PI / 2}
          receiveShadow
          onClick={(e) => {
            if (e.delta < 5) onSelect(null)
          }}
        >
          <planeGeometry args={[W, D]} />
          <meshStandardMaterial color="#E8DFD0" roughness={0.9} />
        </mesh>
        <Walls W={W} D={D} H={room.room.ceiling_height} t={room.room.wall_thickness} />

        <Suspense fallback={null}>
          {objects.map((o) => (
            <Piece
              key={o.name}
              roomId={room.id}
              obj={o}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onSelect(o.name)
                if (o.movable) startDrag(o, e)
              }}
            />
          ))}
        </Suspense>

        {objects
          .filter((o) => o.name === selected || warned.has(o.name))
          .map((o) => (
            <Footprint key={o.name} obj={o} color={warned.has(o.name) ? WARN : ACCENT} />
          ))}

        <DragController drag={drag} onDrag={props.onDrag} onDragEnd={props.onDragEnd} />
        <OrbitControls
          makeDefault
          enabled={!dragging}
          target={[0, 0.3, 0]}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={1}
          maxDistance={span * 4}
        />
      </Canvas>
      <LoadingNote />
    </>
  )
}

function LoadingNote() {
  const { active } = useProgress()
  return active ? <div className="loading">Loading furniture…</div> : null
}

/** Tracks pointer moves on the canvas while a piece is being dragged. */
function DragController({
  drag,
  onDrag,
  onDragEnd,
}: {
  drag: RefObject<Drag | null>
  onDrag: Props['onDrag']
  onDragEnd: Props['onDragEnd']
}) {
  const { camera, gl, controls } = useThree()
  const raycaster = useMemo(() => new Raycaster(), [])

  useEffect(() => {
    const setOrbit = (on: boolean) => {
      if (controls) (controls as unknown as { enabled: boolean }).enabled = on
    }
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      setOrbit(false)
      const rect = gl.domElement.getBoundingClientRect()
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = floorHit(raycaster.ray)
      if (!hit) return
      d.last = [hit[0] + d.offset[0], hit[1] + d.offset[1]]
      onDrag(d.name, d.last)
    }
    const up = () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      setOrbit(true)
      onDragEnd(d.name, d.last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [camera, gl, controls, raycaster, drag, onDrag, onDragEnd])

  return null
}

function Piece({
  roomId,
  obj,
  onPointerDown,
}: {
  roomId: string
  obj: RoomObject
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { scene } = useGLTF(meshUrl(roomId, obj.mesh))
  const [r, g, b, a] = obj.rgba

  const model = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const geom = mesh.geometry
      if (!geom.attributes.normal) geom.computeVertexNormals()
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
      const textured = mats.some((m) => (m as MeshStandardMaterial).map)
      if (!textured && !geom.attributes.color) {
        mesh.material = new MeshStandardMaterial({
          color: new Color(r, g, b),
          opacity: a,
          transparent: a < 1,
          roughness: 0.8,
        })
      }
    })
    return root
  }, [scene, r, g, b, a])

  return (
    <group
      position={roomToThree([obj.pos[0], obj.pos[1], 0])}
      rotation-y={obj.yaw}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = obj.movable ? 'grab' : 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      <group rotation-x={-Math.PI / 2}>
        <primitive object={model} />
      </group>
    </group>
  )
}

function Footprint({ obj, color }: { obj: RoomObject; color: string }) {
  const points = footprintCorners(obj.pos, obj.size, obj.yaw).map(([x, y]) => roomToThree([x, y, 0.01]))
  return <Line points={[...points, points[0]]} color={color} lineWidth={2.5} />
}

interface WallSpec {
  pos: Vec3
  size: Vec3
  normal: [number, number] // outward, in three (x, z)
}

/** Four walls; any wall between the camera and the room centre is hidden. */
function Walls({ W, D, H, t }: { W: number; D: number; H: number; t: number }) {
  const walls = useMemo<WallSpec[]>(
    () => [
      { pos: [0, H / 2, -(D / 2 + t / 2)], size: [W + 2 * t, H, t], normal: [0, -1] },
      { pos: [0, H / 2, D / 2 + t / 2], size: [W + 2 * t, H, t], normal: [0, 1] },
      { pos: [W / 2 + t / 2, H / 2, 0], size: [t, H, D], normal: [1, 0] },
      { pos: [-(W / 2 + t / 2), H / 2, 0], size: [t, H, D], normal: [-1, 0] },
    ],
    [W, D, H, t],
  )
  const refs = useRef<(Mesh | null)[]>([])

  useFrame(({ camera }) => {
    walls.forEach((w, i) => {
      const m = refs.current[i]
      if (!m) return
      const out = (camera.position.x - w.pos[0]) * w.normal[0] + (camera.position.z - w.pos[2]) * w.normal[1]
      m.visible = out < 0
    })
  })

  return (
    <>
      {walls.map((w, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m
          }}
          position={w.pos}
          receiveShadow
        >
          <boxGeometry args={w.size} />
          <meshStandardMaterial color="#FBF9F5" roughness={0.95} />
        </mesh>
      ))}
    </>
  )
}
