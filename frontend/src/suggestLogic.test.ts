import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { acceptError, previewObject } from './suggestLogic'
import type { Suggestion } from './types'

const sug = (id: string, extra: Partial<Suggestion> = {}): Suggestion => ({
  catalog_id: id,
  title: 'Lamp',
  label: 'lamp',
  price: 20,
  currency: 'USD',
  url: 'https://example.com/lamp',
  size: [0.3, 0.3, 1.5],
  rgba: [0.5, 0.5, 0.5, 1],
  model: null,
  photo: null,
  pos: [1, -0.5],
  yaw: 0.5,
  reason: 'Fills the corner.',
  mandate_ok: true,
  violations: [],
  ...extra,
})

describe('previewObject', () => {
  it('is a hidden, unmovable ghost at the suggested spot', () => {
    const o = previewObject(sug('a', { shape: 'floor-lamp' }))
    expect(o).toMatchObject({ hidden: true, movable: false, pos: [1, -0.5, 0], yaw: 0.5, mesh: null, shape: 'floor-lamp' })
    expect(o.size).toEqual([0.3, 0.3, 1.5])
  })

  it('points at the catalog model when there is one', () => {
    expect(previewObject(sug('a', { model: 'models/lamp.glb' })).mesh).toBe('catalog/models/lamp.glb')
  })

  it('gives each catalog piece its own name', () => {
    expect(previewObject(sug('a')).name).not.toBe(previewObject(sug('b')).name)
  })
})

describe('acceptError', () => {
  it('uses the server message', () => {
    expect(acceptError(new ApiError(409, 'That spot is no longer free.'))).toBe('That spot is no longer free.')
  })

  it('words a 409 without a message', () => {
    expect(acceptError(new ApiError(409, undefined))).toBe('That spot is no longer free.')
  })

  it('falls back to the error text', () => {
    expect(acceptError(new Error('Cannot reach the Otto server.'))).toBe('Cannot reach the Otto server.')
  })
})
