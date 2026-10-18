import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { floorRepeat, plankLayout, seededRandom } from './floorPlanks'

const WIDTH = 1024
const HEIGHT = 512

/** A light-wood floor drawn once on a canvas, repeated so planks are about 15 cm wide at room scale. */
export function makeFloorTexture(W: number, D: number, anisotropy = 1): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const rand = seededRandom(31)
  ctx.fillStyle = '#d9b98f'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  for (const p of plankLayout()) {
    const x = p.x * WIDTH
    const y = p.y * HEIGHT
    const w = p.w * WIDTH
    const h = p.h * HEIGHT
    ctx.fillStyle = `hsl(33, 46%, ${70 + p.shade * 5}%)`
    ctx.fillRect(x, y, w, h)
    // grain: a few faint, slightly wavy lines along the plank
    ctx.lineWidth = 1
    for (let i = 0; i < 7; i++) {
      const gy = y + 4 + rand() * (h - 8)
      const sway = (rand() - 0.5) * 4
      ctx.strokeStyle = `rgba(110, 70, 30, ${0.05 + rand() * 0.08})`
      ctx.beginPath()
      ctx.moveTo(x, gy)
      ctx.quadraticCurveTo(x + w / 2, gy + sway, x + w, gy)
      ctx.stroke()
    }
    // the gaps between planks
    ctx.fillStyle = 'rgba(70, 42, 18, 0.35)'
    ctx.fillRect(x, y + h - 1.5, w, 1.5)
    ctx.fillRect(x, y, 1.5, h)
  }

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.repeat.set(...floorRepeat(W, D))
  tex.anisotropy = anisotropy
  return tex
}
