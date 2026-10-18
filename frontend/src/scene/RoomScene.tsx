import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  ContactShadows,
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
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode, type EffectComposer as EffectComposerImpl } from 'postprocessing'
import {
  Box3,
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
import {
  footprintCorners,
  footprintGap,
  footprintsOverlap,
  formatDistance,
  isTight,
  outsideWalls,
  roomToThree,
  snapToWalls,
  threeToRoom,
  wallGaps,
} from '../geometry'
import { TOUR_MS, tourPose } from './tourPath'
import type { Room, RoomObject, Vec2, Vec3 } from '../types'
import { fitTransform } from './fitModel'
import { makeFloorTexture } from './floorTexture'
import ModelBoundary from './ModelBoundary'
import StandIn from './StandIn'

const ACCENT = '#2F5D50'
const WARN = '#C2412D'
const CAUTION = '#B7791F'
const SNAP_KEY = 'otto.snap'
const QUALITY_KEY = 'otto.quality'
const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0)
const GRID_STEP = 0.5 // metres
const GHOST_OPACITY = 0.15
const PREVIEW_OPACITY = 0.45
const BACKGROUND_TONE_MAPPED: [number, number, number] = [2.9462, 2.2915, 1.581]

type View = 'persp' | 'top'
type Quality = 'high' | 'low'

interface Props {
  room: Room
  objects: RoomObject[]
  /** Suggested pieces, drawn as non-interactive ghosts. */
  previews?: RoomObject[]
  selected: string | null
  warned: Set<string>
  dragging: boolean
  onSelect: (name: string | null) => void
  onDragStart: (name: string) => void
  onDrag: (name: string, pos: Vec2) => void
  onDragEnd: (name: string, pos: Vec2 | null) => void
  /** Capture mode: walk the camera around this piece for a video, instead of free orbiting. */
  tour?: string
}

interface Drag {
  name: string
  offset: Vec2
  last: Vec2 | null
}

function loadSnap(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'off'
  } catch {
    return true
  }
}

function loadQuality(): Quality {
  try {
    return localStorage.getItem(QUALITY_KEY) === 'low' ? 'low' : 'high'
  } catch {
    return 'high'
  }
}

/** Room-frame (x, y) where a ray hits the floor, or null. */
function floorHit(ray: Ray): Vec2 | null {
  const p = ray.intersectPlane(FLOOR_PLANE, new Vector3())
  if (!p) return null
  const [x, y] = threeToRoom([p.x, p.y, p.z])
  return [x, y]
}

export default function RoomScene(props: Props) {
  const { room, objects, previews = [], selected, warned, dragging, onSelect } = props
  const [W, D] = room.room.size_xy
  const span = Math.max(W, D)
  const drag = useRef<Drag | null>(null)
  const [view, setView] = useState<View>('persp')
  const [showPoints, setShowPoints] = useState(false)
  const [snap, setSnap] = useState(loadSnap)
  const [quality, setQuality] = useState(loadQuality)
  const high = quality === 'high'
  const capture = useRef<(() => void) | null>(null)
  const composer = useRef<EffectComposerImpl | null>(null)
  const pointCloud = room.room.point_cloud
  const selectedObj = objects.find((o) => o.name === selected && !o.hidden)

  const visibleCorners = objects.filter((o) => !o.hidden).map((o) => footprintCorners(o.pos, o.size, o.yaw))
  const previewClashes = (o: RoomObject) => {
    const corners = footprintCorners(o.pos, o.size, o.yaw)
    return outsideWalls(corners, room.room.size_xy) || visibleCorners.some((c) => footprintsOverlap(corners, c))
  }

  // Where a dragged piece lands: flush against a wall when it is close to one.
  const snapPos = useRef<(name: string, pos: Vec2) => Vec2>((_, pos) => pos)
  snapPos.current = (name, pos) => {
    const o = objects.find((x) => x.name === name)
    return snap && o ? snapToWalls(pos, o.size, o.yaw, room.room.size_xy) : pos
  }

  const toggleSnap = () => {
    const next = !snap
    setSnap(next)
    try {
      localStorage.setItem(SNAP_KEY, next ? 'on' : 'off')
    } catch {
      // storage unavailable: the choice only lasts this visit
    }
  }

  const toggleQuality = () => {
    const next: Quality = high ? 'low' : 'high'
    setQuality(next)
    try {
      localStorage.setItem(QUALITY_KEY, next)
    } catch {
      // storage unavailable: the choice only lasts this visit
    }
  }

  // The light looks at the room's centre; its shadow box is a cube around everything within reach of the floor centre.
  const lightPos: Vec3 = [span * 0.6, span * 1.4, span * 0.8]
  const lightDist = Math.hypot(...lightPos)
  const reach = Math.hypot(W / 2, room.room.ceiling_height, D / 2)

  const startDrag = (obj: RoomObject, e: ThreeEvent<PointerEvent>) => {
    const hit = floorHit(e.ray)
    if (!hit) return
    drag.current = { name: obj.name, offset: [obj.pos[0] - hit[0], obj.pos[1] - hit[1]], last: null }
    props.onDragStart(obj.name)
  }

  return (
    <>
      {/* R3F already renders with ACES filmic tone mapping and sRGB output, so neither is set here. */}
      <Canvas
        shadows={high ? 'percentage' : false}
        dpr={[1, high ? 2 : 1]}
        onPointerMissed={() => onSelect(null)}
      >
        {/* The floor plan uses a true orthographic camera so tall furniture never pokes past the walls. */}
        {view === 'persp' ? (
          <PerspectiveCamera
            makeDefault
            position={[span * 0.8, span * 1.0, span * 1.1]}
            fov={props.tour ? 62 : 45}
            near={0.05}
            far={100}
          />
        ) : (
          <TopCamera W={W} D={D} />
        )}
        {/* With the effects on, the whole picture is tone mapped, background included. These linear values come out as #F7F4EF. */}
        <color attach="background" key={high ? 'ao' : 'plain'} args={high ? BACKGROUND_TONE_MAPPED : ['#F7F4EF']} />
        <hemisphereLight args={['#ffffff', '#d9cfbf', 0.5]} />
        <directionalLight
          position={lightPos}
          intensity={1.6}
          castShadow={high}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-radius={4}
          shadow-camera-left={-reach}
          shadow-camera-right={reach}
          shadow-camera-top={reach}
          shadow-camera-bottom={-reach}
          shadow-camera-near={Math.max(0.1, lightDist - reach)}
          shadow-camera-far={lightDist + reach}
        />
        <Environment resolution={128}>
          <Lightformer intensity={1.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
          <Lightformer intensity={0.6} color="#fff3e0" position={[5, 2, 0]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} />
          <Lightformer intensity={0.4} position={[-5, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} />
        </Environment>

        <Floor W={W} D={D} wood={high} onClick={() => onSelect(null)} />
        {/* Always mounted: drei does not free its render targets on unmount. Hidden and paused in Low quality.
            Its camera starts 3 cm up so the floor, grid and outlines drawn on it stay out of the shadow. */}
        <ContactShadows
          position={[0, 0.002, 0]}
          visible={high}
          frames={high ? Infinity : 0}
          width={W}
          height={D}
          near={0.03}
          far={2}
          blur={2.5}
          opacity={0.55}
          resolution={1024}
        />
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
        {previews.map((o) => (
          <Suspense key={o.name} fallback={null}>
            <Preview roomId={room.id} obj={o} />
          </Suspense>
        ))}

        {previews.map((o) => (
          <Footprint key={o.name} obj={o} color={previewClashes(o) ? WARN : ACCENT} dashed />
        ))}
        {objects
          .filter((o) => !o.hidden && (o.name === selected || warned.has(o.name)))
          .map((o) => (
            <Footprint key={o.name} obj={o} color={warned.has(o.name) ? WARN : ACCENT} />
          ))}
        {selectedObj && <WallMeasure obj={selectedObj} sizeXY={room.room.size_xy} />}
        {selectedObj && (
          <NearestGap obj={selectedObj} others={objects.filter((o) => !o.hidden && o.name !== selectedObj.name)} />
        )}

        {pointCloud && showPoints && (
          <Suspense fallback={null}>
            <PointCloud url={meshUrl(room.id, pointCloud)} />
          </Suspense>
        )}

        {/* Soft ambient occlusion in High quality. The composer turns off the renderer's tone mapping, so it is redone last. */}
        {high && (
          <EffectComposer ref={composer}>
            <N8AO aoRadius={0.5} distanceFalloff={0.6} intensity={1.5} halfRes />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}

        <CaptureBridge capture={capture} composer={composer} filename={`otto-${room.id}.png`} />
        <DragController drag={drag} snapPos={snapPos} onDrag={props.onDrag} onDragEnd={props.onDragEnd} />
        {props.tour ? (
          <TourCamera room={room} piece={objects.find((o) => o.name === props.tour && !o.hidden)} />
        ) : (
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
        )}
      <ReadyFlag />
      </Canvas>
      <div className="scene-toolbar">
        <button className={view === 'persp' ? 'on' : ''} onClick={() => setView('persp')}>3D view</button>
        <button className={view === 'top' ? 'on' : ''} onClick={() => setView('top')}>Top view</button>
        <button className={snap ? 'on' : ''} onClick={toggleSnap}>Snap</button>
        <button className={high ? 'on' : ''} title="Shadows, soft corner shading and a wood floor. Switch to Low on a slow computer." onClick={toggleQuality}>
          Quality: {high ? 'High' : 'Low'}
        </button>
        <button onClick={() => capture.current?.()}>Save image</button>
        {pointCloud && (
          <button className={showPoints ? 'on' : ''} onClick={() => setShowPoints((v) => !v)}>Scan points</button>
        )}
      </div>
      <LoadingNote />
    </>
  )
}

/** The floor: light wood planks, or one plain colour in Low quality. */
function Floor({ W, D, wood, onClick }: { W: number; D: number; wood: boolean; onClick: () => void }) {
  const gl = useThree((s) => s.gl)
  const texture = useMemo(
    () => (wood ? makeFloorTexture(W, D, Math.min(8, gl.capabilities.getMaxAnisotropy())) : null),
    [wood, W, D, gl],
  )
  useEffect(() => () => texture?.dispose(), [texture])
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      receiveShadow
      onClick={(e) => {
        if (e.delta < 5) onClick()
      }}
    >
      <planeGeometry args={[W, D]} />
      <meshStandardMaterial key={texture ? 'wood' : 'plain'} color={texture ? '#ffffff' : '#E8DFD0'} map={texture} roughness={0.9} />
    </mesh>
  )
}

/** Hands the toolbar a function that downloads the current view as a PNG. */
function CaptureBridge({
  capture,
  composer,
  filename,
}: {
  capture: RefObject<(() => void) | null>
  composer: RefObject<EffectComposerImpl | null>
  filename: string
}) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    capture.current = () => {
      // Draw a fresh frame and read it in the same task, before the browser clears the buffer.
      if (composer.current) composer.current.render()
      else gl.render(scene, camera)
      gl.domElement.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    }
    return () => {
      capture.current = null
    }
  }, [gl, scene, camera, capture, composer, filename])
  return null
}

/**
 * Tour mode: holds the first pose until the page calls window.__ottoStartTour(), then walks the path
 * and marks the page with data-tour-done, so a recording can cut exactly the walk.
 */
function TourCamera({ room, piece }: { room: Room; piece: RoomObject | undefined }) {
  const start = useRef<number | null>(null)
  useEffect(() => {
    const w = window as unknown as { __ottoStartTour?: () => void }
    w.__ottoStartTour = () => {
      start.current = performance.now()
    }
    return () => {
      delete w.__ottoStartTour
      delete document.documentElement.dataset.tourDone
    }
  }, [])
  useFrame(({ camera }) => {
    if (!piece) return
    const t = start.current === null ? 0 : (performance.now() - start.current) / TOUR_MS
    const { position, target } = tourPose(t, room.room.size_xy, piece.pos, piece.size)
    camera.position.set(...position)
    camera.lookAt(...target)
    if (t >= 1) document.documentElement.dataset.tourDone = '1'
  })
  return null
}

/** Marks the page once every model has loaded and a few frames have drawn, so a screenshot can wait for it. */
function ReadyFlag() {
  const { active, loaded, total } = useProgress()
  const frames = useRef(0)
  useFrame(() => {
    if (active || loaded < total) {
      frames.current = 0
      return
    }
    frames.current += 1
    if (frames.current === 30) document.documentElement.dataset.sceneReady = '1'
  })
  useEffect(() => () => {
    delete document.documentElement.dataset.sceneReady
  }, [])
  return null
}

function LoadingNote() {
  const { active } = useProgress()
  return active ? <div className="loading">Loading furniture…</div> : null
}

/** Tracks pointer moves on the canvas while a piece is being dragged. */
function DragController({
  drag,
  snapPos,
  onDrag,
  onDragEnd,
}: {
  drag: RefObject<Drag | null>
  snapPos: RefObject<(name: string, pos: Vec2) => Vec2>
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
      d.last = snapPos.current(d.name, [hit[0] + d.offset[0], hit[1] + d.offset[1]])
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
  }, [camera, gl, controls, raycaster, drag, snapPos, onDrag, onDragEnd])

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
        <Model roomId={roomId} obj={obj} />
      </group>
    </group>
  )
}

/** A suggested piece: faint and unclickable. */
function Preview({ roomId, obj }: { roomId: string; obj: RoomObject }) {
  return (
    <group position={roomToThree([obj.pos[0], obj.pos[1], 0])} rotation-y={obj.yaw}>
      <group rotation-x={-Math.PI / 2}>
        <Model roomId={roomId} obj={obj} ghostOpacity={PREVIEW_OPACITY} />
      </group>
    </group>
  )
}

/** The piece's model, or a stand-in of the same pose and size when it has none or its file fails to load. */
function Model({ roomId, obj, ghostOpacity }: { roomId: string; obj: RoomObject; ghostOpacity?: number }) {
  const standIn = <StandIn obj={obj} ghostOpacity={ghostOpacity} />
  if (!obj.mesh) return standIn
  const url = meshUrl(roomId, obj.mesh)
  return (
    <ModelBoundary resetKey={url} fallback={standIn}>
      <GlbModel url={url} obj={obj} ghostOpacity={ghostOpacity} />
    </ModelBoundary>
  )
}

function GlbModel({ url, obj, ghostOpacity = GHOST_OPACITY }: { url: string; obj: RoomObject; ghostOpacity?: number }) {
  const { scene } = useGLTF(url)
  const [r, g, b, a] = obj.rgba
  const ghost = !!obj.hidden
  const [w, d, h] = obj.size
  const normalize = !!obj.normalize

  const { model, fit } = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = !ghost
      mesh.receiveShadow = !ghost
      const geom = mesh.geometry
      // Meshes written by trimesh carry no normals; without them everything renders black.
      const flat = !geom.attributes.normal
      if (flat) geom.computeVertexNormals()
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
      const textured = mats.some((m) => (m as MeshStandardMaterial).map)
      if (normalize) {
        // An upload keeps the materials it came with.
      } else if (geom.attributes.color) {
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
      if (ghost) {
        // A replaced piece: faint, unclickable. Clone materials so the cached GLTF stays untouched.
        mesh.raycast = () => null
        const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
          const c = m.clone()
          c.transparent = true
          c.opacity = ghostOpacity
          c.depthWrite = false
          return c
        })
        mesh.material = Array.isArray(mesh.material) ? own : own[0]
      }
    })
    // An uploaded model is y-up, in any units and anywhere in space: stretch it to the piece's size.
    const box = normalize ? new Box3().setFromObject(root) : null
    const fit = box && !box.isEmpty() ? fitTransform({ min: box.min.toArray(), max: box.max.toArray() }, [w, d, h]) : null
    return { model: root, fit }
  }, [scene, r, g, b, a, ghost, ghostOpacity, normalize, w, d, h])

  if (!fit) return <primitive object={model} />
  // The caller's group maps the room frame (z-up) to three.js. Turning +90 degrees about x here undoes that,
  // so the model's own axes are three.js axes again: x = width, y = height, z = depth. The fit is in those axes.
  return (
    <group rotation-x={Math.PI / 2}>
      <group position={fit.position} scale={fit.scale}>
        <primitive object={model} />
      </group>
    </group>
  )
}

function Footprint({ obj, color, dashed }: { obj: RoomObject; color: string; dashed?: boolean }) {
  const points = footprintCorners(obj.pos, obj.size, obj.yaw).map(([x, y]) => roomToThree([x, y, 0.01]))
  return (
    <Line points={[...points, points[0]]} color={color} lineWidth={2.5} dashed={dashed} dashSize={0.08} gapSize={0.05} />
  )
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
          <DistanceLine key={i} a={a} b={b} gap={gap} />
        ))}
    </>
  )
}

/** A dashed line on the floor with its length in a label. */
function DistanceLine({ a, b, gap }: { a: Vec2; b: Vec2; gap: number }) {
  const tight = isTight(gap)
  return (
    <group>
      <Line
        points={[roomToThree([a[0], a[1], 0.02]), roomToThree([b[0], b[1], 0.02])]}
        color={tight ? CAUTION : ACCENT}
        lineWidth={1.5}
        dashed
        dashSize={0.05}
        gapSize={0.03}
      />
      <Html position={roomToThree([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.05])} center className={tight ? 'dist tight' : 'dist'}>
        {formatDistance(gap)}
        {tight && ' · tight'}
      </Html>
    </group>
  )
}

/** Gap from the selected piece to the nearest other visible piece. Nothing if they touch or overlap. */
function NearestGap({ obj, others }: { obj: RoomObject; others: RoomObject[] }) {
  const mine = footprintCorners(obj.pos, obj.size, obj.yaw)
  let nearest: ReturnType<typeof footprintGap> | null = null
  for (const o of others) {
    const g = footprintGap(mine, footprintCorners(o.pos, o.size, o.yaw))
    if (!nearest || g.gap < nearest.gap) nearest = g
  }
  if (!nearest || nearest.gap < 0.005) return null
  return <DistanceLine a={nearest.from} b={nearest.to} gap={nearest.gap} />
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
