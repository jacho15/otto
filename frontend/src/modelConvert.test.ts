import { describe, expect, it } from 'vitest'
import { MAX_MODEL_BYTES } from './furnitureLogic'
import { guessUnit, modelFormat, tooBigText, unitNote, upTurn } from './modelConvert'

describe('guessUnit', () => {
  it('treats a big model as millimetres', () => {
    expect(guessUnit(850)).toEqual({ unit: 'mm', divisor: 1000 })
    expect(guessUnit(300.5)).toEqual({ unit: 'mm', divisor: 1000 })
  })

  it('treats a mid-size model as centimetres', () => {
    expect(guessUnit(85)).toEqual({ unit: 'cm', divisor: 100 })
    expect(guessUnit(300)).toEqual({ unit: 'cm', divisor: 100 })
    expect(guessUnit(3.5)).toEqual({ unit: 'cm', divisor: 100 })
  })

  it('treats a small model as metres', () => {
    expect(guessUnit(3)).toEqual({ unit: 'm', divisor: 1 })
    expect(guessUnit(0.85)).toEqual({ unit: 'm', divisor: 1 })
    expect(guessUnit(0)).toEqual({ unit: 'm', divisor: 1 })
  })
})

describe('unitNote', () => {
  it('says which unit was assumed', () => {
    expect(unitNote(guessUnit(850))).toContain('millimetres (divided by 1000)')
    expect(unitNote(guessUnit(85))).toContain('centimetres (divided by 100)')
    expect(unitNote(guessUnit(1))).toContain('metres (used as it is)')
  })

  it('says when a Z-up model was turned upright', () => {
    expect(unitNote(guessUnit(1))).not.toContain('turned')
    expect(unitNote(guessUnit(1), true)).toContain('Z is up and turned the model upright')
  })
})

describe('upTurn', () => {
  it('turns .stl and .ply from Z-up to Y-up and leaves .obj alone', () => {
    expect(upTurn('stl')).toBeCloseTo(-Math.PI / 2)
    expect(upTurn('ply')).toBeCloseTo(-Math.PI / 2)
    expect(upTurn('obj')).toBe(0)
  })
})

describe('tooBigText', () => {
  it('accepts up to the server limit and explains a larger file', () => {
    expect(tooBigText(MAX_MODEL_BYTES)).toBeNull()
    expect(tooBigText(MAX_MODEL_BYTES + 1)).toBe('The converted model is 25.1 MB, over the 25 MB limit. Use a smaller model.')
    expect(tooBigText(40 * 1024 * 1024)).toContain('40 MB')
  })
})

describe('modelFormat', () => {
  it('reads the extension, ignoring case', () => {
    expect(modelFormat('Chair.OBJ')).toBe('obj')
    expect(modelFormat('a.b.stl')).toBe('stl')
    expect(modelFormat('scan.ply')).toBe('ply')
    expect(modelFormat('chair.glb')).toBeNull()
    expect(modelFormat('chair.obj.txt')).toBeNull()
  })
})
