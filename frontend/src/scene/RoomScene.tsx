import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  Environment,
  Html,
  Lightformer,
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  useGLTF,
  useProgress,
} from '@react-three/drei'
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Ray,
} from 'three'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { meshUrl } from '../api'
import { footprintCorners, formatDistance, roomToThree, threeToRoom, wallGaps } from '../geometry'
import type { Room, RoomObject, Vec2, Vec3 } from '../types'

const ACCENT = '#2F5D50'
const WARN = '#C2412D'
const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0)
const GRID_STEP = 0.5 // metres

type View = 'persp' | 'top'

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
  const [view, setView] = useState<View>('persp')
  const [showPoints, setShowPoints] = useState(false)
  const pointCloud = room.room.point_cloud
  const selectedObj = objects.find((o) => o.name === selected)

  const startDrag = (obj: RoomObject, e: ThreeEvent<PointerEvent>) => {
    const hit = floorHit(e.ray)
    if (!hit) return
    drag.current = { name: obj.name, offset: [obj.pos[0] - hit[0], obj.pos[1] - hit[1]], last: null }
    props.onDragStart(obj.name)
  }

  return (
    <>
      <Canvas shadows onPointerMissed={() => onSelect(null)}>
        {/* The floor plan uses a true orthographic camera so tall furniture never pokes past the walls. */}
        {view === 'persp' ? (
          <PerspectiveCamera
            makeDefault
            position={[span * 0.8, span * 1.0, span * 1.1]}
            fov={45}
            near={0.05}
            far={100}
          />
        ) : (
          <TopCamera W={W} D={D} />
        )}
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
        <FloorGrid W={W} D={D} />
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
        {selectedObj && <WallMeasure obj={selectedObj} sizeXY={room.room.size_xy} />}

        {pointCloud && showPoints && (
          <Suspense fallback={null}>
            <PointCloud url={meshUrl(room.id, pointCloud)} />
          </Suspense>
        )}

        <DragController drag={drag} onDrag={props.onDrag} onDragEnd={props.onDragEnd} />
        <OrbitControls
          key={view}
          makeDefault
          enabled={!dragging}
          enableRotate={view === 'persp'}
          screenSpacePanning
          target={view === 'persp' ? [0, 0.3, 0] : [0, 0, 0]}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={1}
          maxDistance={span * 4}
        />
      </Canvas>
      <div className="scene-toolbar">
        <button className={view === 'persp' ? 'on' : ''} onClick={() => setView('persp')}>3D view</button>
        <button className={view === 'top' ? 'on' : ''} onClick={() => setView('top')}>Top view</button>
        {pointCloud && (
          <button className={showPoints ? 'on' : ''} onClick={() => setShowPoints((v) => !v)}>Scan points</button>
        )}
      </div>
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
      // Meshes written by trimesh carry no normals; without them everything renders black.
      const flat = !geom.attributes.normal
      if (flat) geom.computeVertexNormals()
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
      const textured = mats.some((m) => (m as MeshStandardMaterial).map)
      if (geom.attributes.color) {
        // Scanned and reconstructed pieces are coloured per vertex.
        mesh.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: flat })
      } else if (!textured) {
        mesh.material = new MeshStandardMaterial({
          color: new Color().setRGB(r, g, b, SRGBColorSpace),
          opacity: a,
          transparent: a < 1,
          roughness: 0.8,
          flatShading: flat,
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

/** Orthographic camera looking straight down, zoomed so the whole floor fits. */
function TopCamera({ W, D }: { W: number; D: number }) {
  const { size } = useThree()
  const zoom = Math.min(size.width / W, size.height / D) / 1.15
  return (
    <OrthographicCamera
      makeDefault
      position={[0, 20, 0]}
      up={[0, 0, -1]} // room +y points up the screen
      zoom={zoom}
      near={0.05}
      far={100}
      onUpdate={(c) => c.lookAt(0, 0, 0)}
    />
  )
}

/** 50 cm grid clipped to the floor, so sizes can be judged at a glance. */
function FloorGrid({ W, D }: { W: number; D: number }) {
  const positions = useMemo(() => {
    const pts: number[] = []
    for (let x = -W / 2; x <= W / 2 + 1e-6; x += GRID_STEP) pts.push(x, 0.002, -D / 2, x, 0.002, D / 2)
    for (let z = -D / 2; z <= D / 2 + 1e-6; z += GRID_STEP) pts.push(-W / 2, 0.002, z, W / 2, 0.002, z)
    return new Float32Array(pts)
  }, [W, D])
  return (
    <lineSegments raycast={() => null}>
      <bufferGeometry key={positions.length}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#000000" transparent opacity={0.08} />
    </lineSegments>
  )
}

/** Distance from the selected piece to each wall, drawn on the floor. */
function WallMeasure({ obj, sizeXY }: { obj: RoomObject; sizeXY: Vec2 }) {
  const corners = footprintCorners(obj.pos, obj.size, obj.yaw)
  const gaps = wallGaps(corners, sizeXY)
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const [cx, cy] = obj.pos
  const hx = sizeXY[0] / 2
  const hy = sizeXY[1] / 2
  const segs: [Vec2, Vec2, number][] = [
    [[Math.max(...xs), cy], [hx, cy], gaps['+x']],
    [[Math.min(...xs), cy], [-hx, cy], gaps['-x']],
    [[cx, Math.max(...ys)], [cx, hy], gaps['+y']],
    [[cx, Math.min(...ys)], [cx, -hy], gaps['-y']],
  ]
  return (
    <>
      {segs
        .filter(([, , gap]) => gap >= 0.005)
        .map(([a, b, gap], i) => (
          <group key={i}>
            <Line
              points={[roomToThree([a[0], a[1], 0.02]), roomToThree([b[0], b[1], 0.02])]}
              color={ACCENT}
              lineWidth={1.5}
              dashed
              dashSize={0.05}
              gapSize={0.03}
            />
            <Html position={roomToThree([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.05])} center className="dist">
              {formatDistance(gap)}
            </Html>
          </group>
        ))}
    </>
  )
}

function PointCloud({ url }: { url: string }) {
  const geom = useLoader(PLYLoader, url) as BufferGeometry
  return (
    <points geometry={geom} rotation-x={-Math.PI / 2} raycast={() => null}>
      <pointsMaterial size={0.015} vertexColors={!!geom.attributes.color} />
    </points>
  )
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
