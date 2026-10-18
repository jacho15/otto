// Turns .obj, .stl and .ply files into a binary .glb in the browser, so they go through the .glb upload.
import { Box3, DoubleSide, Group, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Object3D } from 'three'
import { MAX_MODEL_BYTES } from './furnitureLogic'
import type { Vec3 } from './types'

export type ModelFormat = 'obj' | 'stl' | 'ply'
export type FileUnit = 'mm' | 'cm' | 'm'

export function modelFormat(name: string): ModelFormat | null {
  const m = /\.(obj|stl|ply)$/i.exec(name)
  return m ? (m[1].toLowerCase() as ModelFormat) : null
}

/**
 * The unit a model is probably in, from its largest side as read from the file. Furniture is rarely over 3 m,
 * so up to 3 is metres. Above that, a piece of furniture in cm reads at most about 300; in mm it reads 300 or more.
 */
export function guessUnit(largestSide: number): { unit: FileUnit; divisor: number } {
  if (largestSide > 300) return { unit: 'mm', divisor: 1000 }
  if (largestSide > 3) return { unit: 'cm', divisor: 100 }
  return { unit: 'm', divisor: 1 }
}

/** .stl and .ply files are usually Z-up. The turn about X that makes them Y-up, as glTF is. .obj is already Y-up. */
export function upTurn(format: ModelFormat): number {
  return format === 'obj' ? 0 : -Math.PI / 2
}

/** The message for a converted model that the server would refuse as too big, or null if it fits. */
export function tooBigText(bytes: number): string | null {
  if (bytes <= MAX_MODEL_BYTES) return null
  const mb = Math.ceil((bytes / (1024 * 1024)) * 10) / 10
  return `The converted model is ${mb} MB, over the ${MAX_MODEL_BYTES / (1024 * 1024)} MB limit. Use a smaller model.`
}

const UNIT_TEXT: Record<FileUnit, string> = { mm: 'millimetres', cm: 'centimetres', m: 'metres' }

/** The note that says which unit was assumed. */
export function unitNote({ unit, divisor }: { unit: FileUnit; divisor: number }, turned = false): string {
  const how = divisor === 1 ? 'used as it is' : `divided by ${divisor}`
  const up = turned ? ' Assumed Z is up and turned the model upright.' : ''
  return `No size was given, so the size comes from the model. Assumed ${UNIT_TEXT[unit]} (${how}).${up} Change the size if that is wrong.`
}

function asMesh(geometry: BufferGeometry): Mesh {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const material = new MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.8,
    metalness: 0,
    side: DoubleSide,
    vertexColors: !!geometry.getAttribute('color'),
  })
  return new Mesh(geometry, material)
}

async function parse(format: ModelFormat, data: ArrayBuffer): Promise<Object3D> {
  if (format === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    return new OBJLoader().parse(new TextDecoder().decode(data))
  }
  if (format === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    return asMesh(new STLLoader().parse(data))
  }
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
  const geometry = new PLYLoader().parse(data)
  if (!geometry.index) throw new Error('That .ply has no faces (it looks like a point cloud).')
  return asMesh(geometry)
}

/**
 * Read an .obj, .stl or .ply file and write it as a .glb in metres, guessing the unit from its size.
 * .stl and .ply are turned from Z-up to Y-up first. `size` is [width, depth, height] in metres.
 */
export async function convertToGlb(file: File): Promise<{ file: File; size: Vec3; note: string }> {
  const format = modelFormat(file.name)
  if (!format) throw new Error('Choose a .glb, .obj, .stl or .ply file.')
  let root: Object3D
  try {
    root = await parse(format, await file.arrayBuffer())
  } catch (e) {
    throw e instanceof Error && e.message.startsWith('That .ply') ? e : new Error(`Couldn't read that .${format} file.`)
  }
  root.rotation.x = upTurn(format)
  root.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(root)
  if (raw.isEmpty()) throw new Error(`There is no 3D shape in that .${format} file.`)
  const rawSize = raw.getSize(new Vector3())
  const guess = guessUnit(Math.max(rawSize.x, rawSize.y, rawSize.z))

  const scene = new Group()
  scene.add(root)
  scene.scale.setScalar(1 / guess.divisor)
  scene.updateMatrixWorld(true)
  const size = new Box3().setFromObject(scene).getSize(new Vector3())

  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer
  const tooBig = tooBigText(glb.byteLength)
  if (tooBig) throw new Error(tooBig)
  return {
    file: new File([glb], file.name.replace(/\.[^.]*$/, '') + '.glb', { type: 'model/gltf-binary' }),
    size: [size.x, size.z, size.y],
    note: unitNote(guess, format !== 'obj'),
  }
}
