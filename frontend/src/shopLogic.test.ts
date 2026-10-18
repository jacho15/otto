import { describe, expect, it } from 'vitest'
import { footprintCorners, outsideWalls } from './geometry'
import { findFreeSpot, productFit, sortItems, type Fit } from './shopLogic'
import type { CatalogItem, RoomObject, RoomShape, Vec3 } from './types'

const room = (w: number, d: number, h = 2.5): RoomShape => ({ size_xy: [w, d], ceiling_height: h, wall_thickness: 0.1 })

const piece = (name: string, pos: [number, number], size: Vec3, hidden = false): RoomObject => ({
  name,
  label: name,
  mesh: 'meshes/x.glb',
  pos: [pos[0], pos[1], 0],
  yaw: 0,
  size,
  movable: true,
  rgba: [0.5, 0.5, 0.5, 1],
  hidden,
})

const item = (id: string, price: number, size: Vec3, label = 'thing'): CatalogItem => ({
  id,
  title: `${id} title`,
  label,
  url: `https://example.com/${id}`,
  price,
  currency: 'USD',
  size,
  rgba: [0.5, 0.5, 0.5, 1],
  model: `models/${id}.glb`,
  photo: `photos/${id}.jpg`,
})

describe('findFreeSpot', () => {
  it('uses the centre of an empty room', () => {
    expect(findFreeSpot([1, 1, 1], room(4, 3), [])).toEqual({ pos: [0, 0], yaw: 0 })
  })

  it('finds a spot clear of other pieces and inside the walls', () => {
    const objs = [piece('sofa', [0, 0], [2, 1, 0.8])]
    const spot = findFreeSpot([1, 0.8, 0.8], room(4, 3), objs)!
    const corners = footprintCorners(spot.pos, [1, 0.8], spot.yaw)
    expect(outsideWalls(corners, [4, 3])).toBe(false)
    expect(Math.abs(spot.pos[1])).toBeGreaterThanOrEqual(0.9) // above or below the sofa
  })

  it('turns a long piece 90 degrees when only that fits', () => {
    expect(findFreeSpot([2.5, 0.5, 1], room(2, 3), [])?.yaw).toBeCloseTo(Math.PI / 2)
  })

  it('ignores hidden ghosts', () => {
    const full = [piece('ghost', [0, 0], [4, 3, 1], true)]
    expect(findFreeSpot([1, 1, 1], room(4, 3), full)).not.toBeNull()
  })
})

describe('productFit', () => {
  it('fits in a roomy space', () => expect(productFit([1, 1, 1], room(4, 3), [])).toBe('fits'))
  it('is too tall for a low ceiling', () => expect(productFit([1, 1, 2.6], room(4, 3, 2.4), [])).toBe('too-tall'))
  it('is too big even for the empty room', () => expect(productFit([5, 4, 1], room(4, 3), [])).toBe('too-big'))
  it('has no space left when the floor is full', () => {
    const full = [piece('a', [-1, 0], [2, 3, 1]), piece('b', [1, 0], [2, 3, 1])]
    expect(productFit([0.5, 0.5, 0.5], room(4, 3), full)).toBe('no-space')
  })
})

describe('sortItems', () => {
  const items = [item('sofa', 449, [1.8, 0.9, 0.7], 'sofa'), item('desk', 80, [1.1, 0.4, 0.8], 'desk'), item('chair', 199, [0.6, 0.7, 0.7], 'chair')]
  const fits = new Map<string, Fit>([['sofa', 'fits'], ['desk', 'no-space'], ['chair', 'fits']])
  const ids = (xs: CatalogItem[]) => xs.map((x) => x.id)

  it('puts what fits first, cheapest first', () => expect(ids(sortItems(items, fits, 'fit'))).toEqual(['chair', 'sofa', 'desk']))
  it('sorts by price up', () => expect(ids(sortItems(items, fits, 'price-asc'))).toEqual(['desk', 'chair', 'sofa']))
  it('sorts by price down', () => expect(ids(sortItems(items, fits, 'price-desc'))).toEqual(['sofa', 'chair', 'desk']))
  it('sorts by footprint', () => expect(ids(sortItems(items, fits, 'size'))).toEqual(['chair', 'desk', 'sofa']))
  it('sorts by type', () => expect(ids(sortItems(items, fits, 'type'))).toEqual(['chair', 'desk', 'sofa']))
  it('does not change the input', () => {
    sortItems(items, fits, 'price-asc')
    expect(ids(items)).toEqual(['sofa', 'desk', 'chair'])
  })
})
