import { describe, expect, it } from 'vitest'
import { savingsText } from './alternativesLogic'

describe('savingsText', () => {
  it('shows the amount and the percent', () => {
    expect(savingsText(40, 20)).toBe('Save $40.00 (20%)')
  })

  it('uses the given currency', () => {
    expect(savingsText(12.5, 8, 'EUR')).toBe('Save €12.50 (8%)')
  })
})
