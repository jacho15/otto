import { describe, expect, it } from 'vitest'
import {
  checkFile,
  checkSize,
  convertText,
  dropIntent,
  fileKind,
  fromMetres,
  linkFrom,
  parsePrice,
  rangeText,
  titleFromFile,
  toMetres,
} from './furnitureLogic'

describe('sizes', () => {
  it('converts between cm, inches and metres', () => {
    expect(toMetres(85, 'cm')).toBe(0.85)
    expect(toMetres(10, 'in')).toBe(0.254)
    expect(fromMetres(0.85, 'cm')).toBe(85)
    expect(fromMetres(0.254, 'in')).toBe(10)
  })

  it('converts typed text and leaves junk alone', () => {
    expect(convertText('100', 'cm', 'in')).toBe('39.4')
    expect(convertText('39.4', 'in', 'cm')).toBe('100.1')
    expect(convertText('', 'cm', 'in')).toBe('')
    expect(convertText('abc', 'cm', 'in')).toBe('abc')
  })

  it('shows the range in the chosen unit', () => {
    expect(rangeText('width', 'cm')).toBe('5–600 cm')
    expect(rangeText('height', 'in')).toBe('2.0–137.8 in')
  })

  it('accepts a size in metres', () => {
    expect(checkSize(['200', '90', '85'], 'cm')).toEqual({ size: [2, 0.9, 0.85] })
    expect(checkSize(['78.7', '35.4', '33.5'], 'in')).toEqual({ size: [1.999, 0.899, 0.851] })
  })

  it('accepts the limits', () => {
    expect(checkSize(['5', '600', '350'], 'cm')).toEqual({ size: [0.05, 6, 3.5] })
    expect(checkSize(['236.2', '2', '137.8'], 'in')).toEqual({ size: [5.999, 0.051, 3.5] })
  })

  it('explains what is wrong', () => {
    expect(checkSize(['', '90', '85'], 'cm')).toEqual({ error: 'Width must be a number.' })
    expect(checkSize(['200', 'x', '85'], 'cm')).toEqual({ error: 'Depth must be a number.' })
    expect(checkSize(['200', '90', '351'], 'cm')).toEqual({ error: 'Height must be between 5–350 cm.' })
    expect(checkSize(['601', '90', '85'], 'cm')).toEqual({ error: 'Width must be between 5–600 cm.' })
    expect(checkSize(['200', '1', '85'], 'in')).toEqual({ error: 'Depth must be between 2.0–236.2 in.' })
  })
})

describe('parsePrice', () => {
  it('reads an optional price', () => {
    expect(parsePrice('')).toBeNull()
    expect(parsePrice(' 49.99 ')).toBe(49.99)
    expect(parsePrice('-1')).toBeUndefined()
    expect(parsePrice('cheap')).toBeUndefined()
  })
})

describe('files', () => {
  it('tells photos from models', () => {
    expect(fileKind({ name: 'a.jpg', type: 'image/jpeg' })).toBe('photo')
    expect(fileKind({ name: 'A.PNG', type: '' })).toBe('photo')
    expect(fileKind({ name: 'chair.glb', type: '' })).toBe('model')
    expect(fileKind({ name: 'chair.OBJ', type: '' })).toBe('model')
    expect(fileKind({ name: 'chair.stl', type: '' })).toBe('model')
    expect(fileKind({ name: 'chair.ply', type: '' })).toBe('model')
    expect(fileKind({ name: 'a.gif', type: 'image/gif' })).toBeNull()
    expect(fileKind({ name: 'notes.txt', type: 'text/plain' })).toBeNull()
  })

  it('checks the kind and size', () => {
    expect(checkFile('photo', { name: 'a.png', type: 'image/png', size: 1000 })).toBeNull()
    expect(checkFile('photo', { name: 'a.png', type: 'image/png', size: 6 * 1024 * 1024 })).toBe('The photo must be 5 MB or smaller.')
    expect(checkFile('photo', { name: 'a.glb', type: '', size: 1 })).toBe('Choose a JPEG, PNG or WebP photo.')
    expect(checkFile('model', { name: 'a.glb', type: '', size: 26 * 1024 * 1024 })).toBe('The model must be 25 MB or smaller.')
    expect(checkFile('model', { name: 'a.png', type: 'image/png', size: 1 })).toBe('Choose a .glb, .obj, .stl or .ply file.')
  })

  it('makes a title from the file name', () => {
    expect(titleFromFile('green-sofa_v2.glb')).toBe('green sofa v2')
    expect(titleFromFile('sofa')).toBe('sofa')
  })
})

describe('dropped things', () => {
  it('finds a link in a uri list, skipping comments', () => {
    expect(linkFrom('# from a page\r\nhttps://shop.example/p/1\r\n', '')).toBe('https://shop.example/p/1')
  })

  it('finds a link in plain text', () => {
    expect(linkFrom('', ' https://shop.example/p/1 ')).toBe('https://shop.example/p/1')
  })

  it('ignores text that is not a link', () => {
    expect(linkFrom('', 'a nice sofa')).toBeNull()
    expect(linkFrom('', 'javascript:alert(1)')).toBeNull()
    expect(linkFrom('', 'https://a.example https://b.example')).toBeNull()
  })

  it('prefers a file over a link', () => {
    const file = { name: 'sofa.glb', type: '' }
    expect(dropIntent([file], 'https://shop.example/p/1', '')).toEqual({ kind: 'model', file })
  })

  it('reads a photo file, a link or nothing', () => {
    const file = { name: 'sofa.webp', type: 'image/webp' }
    expect(dropIntent([file], '', '')).toEqual({ kind: 'photo', file })
    expect(dropIntent([], '', 'https://shop.example/p/1')).toEqual({ kind: 'link', url: 'https://shop.example/p/1' })
    expect(dropIntent([{ name: 'a.txt', type: 'text/plain' }], '', '')).toBeNull()
  })
})
