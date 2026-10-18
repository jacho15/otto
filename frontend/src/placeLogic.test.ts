import { describe, expect, it } from 'vitest'
import { checkDimension, fromMetres, rangeText, toMetres } from './placeLogic'

describe('unit conversion', () => {
  it('keeps metres', () => expect(toMetres(3.5, 'm')).toBe(3.5))
  it('converts feet to metres', () => expect(toMetres(10, 'ft')).toBe(3.048))
  it('converts metres to feet', () => expect(fromMetres(3.048, 'ft')).toBe(10))
})

describe('rangeText', () => {
  it('shows metres', () => expect(rangeText('width', 'm')).toBe('1.5–15 m'))
  it('shows feet', () => expect(rangeText('height', 'ft')).toBe('6.6–13.1 ft'))
})

describe('checkDimension', () => {
  it('accepts a value in range', () => expect(checkDimension('width', '4', 'm')).toEqual({ metres: 4 }))
  it('accepts the edges', () => {
    expect(checkDimension('width', '1.5', 'm')).toEqual({ metres: 1.5 })
    expect(checkDimension('height', '4', 'm')).toEqual({ metres: 4 })
  })
  it('converts feet before sending', () => expect(checkDimension('depth', '10', 'ft')).toEqual({ metres: 3.048 }))
  it('rejects too small in the chosen unit', () => {
    expect(checkDimension('width', '4', 'ft')).toEqual({ error: 'Width must be between 4.9–49.2 ft.' })
  })
  it('rejects too large', () => {
    expect(checkDimension('height', '5', 'm')).toEqual({ error: 'Ceiling height must be between 2–4 m.' })
  })
  it('rejects empty and non-numbers', () => {
    expect(checkDimension('depth', '', 'm')).toEqual({ error: 'Depth must be a number.' })
    expect(checkDimension('depth', 'abc', 'm')).toEqual({ error: 'Depth must be a number.' })
  })
})
