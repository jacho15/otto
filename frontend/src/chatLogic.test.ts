import { describe, expect, it } from 'vitest'
import { changeLine } from './chatLogic'

describe('changeLine', () => {
  it('names the action and the piece', () => {
    expect(changeLine({ action: 'placed', name: 'a', title: 'LACK Coffee table' })).toBe('Placed LACK Coffee table')
    expect(changeLine({ action: 'moved', name: 'a', title: 'Sofa' })).toBe('Moved Sofa')
    expect(changeLine({ action: 'removed', name: 'a', title: 'Rug' })).toBe('Removed Rug')
  })
})
