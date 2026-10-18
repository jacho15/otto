import { describe, expect, it } from 'vitest'
import { STEPS, TOTAL_MS, itemAt, tickerLine, timelineAt, type DemoFacts } from './demoTimeline'

const facts: DemoFacts = {
  fileName: 'lounge-walkthrough.mp4',
  uploadMb: 21.4,
  frames: 1192,
  candidates: 34,
  kept: 7,
  pieces: ['chair', 'chair', 'sofa', 'lamp', 'coffee table', 'table', 'armchair'],
}

describe('timelineAt', () => {
  it('starts at step 1 with nothing done', () => {
    expect(timelineAt(0)).toEqual({ index: 0, stepProgress: 0, overall: 0, done: false })
  })

  it('treats negative time as the start', () => expect(timelineAt(-500).index).toBe(0))

  it('moves to the next step exactly at a boundary', () => {
    const m = timelineAt(STEPS[0].ms)
    expect(m.index).toBe(1)
    expect(m.stepProgress).toBe(0)
  })

  it('reports progress within a step and overall', () => {
    const m = timelineAt(STEPS[0].ms + STEPS[1].ms / 2)
    expect(m.index).toBe(1)
    expect(m.stepProgress).toBeCloseTo(0.5)
    expect(m.overall).toBeCloseTo((STEPS[0].ms + STEPS[1].ms / 2) / TOTAL_MS)
  })

  it('is done at and after the end', () => {
    expect(timelineAt(TOTAL_MS)).toEqual({ index: STEPS.length, stepProgress: 1, overall: 1, done: true })
    expect(timelineAt(TOTAL_MS * 3).done).toBe(true)
  })

  it('has five steps', () => expect(STEPS.map((s) => s.key)).toEqual(['upload', 'measure', 'find', 'build', 'assemble']))
})

describe('itemAt', () => {
  it('walks through items evenly', () => {
    expect(itemAt(0, 4)).toBe(0)
    expect(itemAt(0.26, 4)).toBe(1)
    expect(itemAt(0.99, 4)).toBe(3)
  })
  it('never goes past the last item', () => expect(itemAt(1, 4)).toBe(3))
  it('copes with no items', () => expect(itemAt(0.5, 0)).toBe(0))
})

describe('tickerLine', () => {
  it('counts the upload', () => expect(tickerLine('upload', 0.5, facts)).toBe('Uploading lounge-walkthrough.mp4: 10.7 of 21.4 MB'))
  it('counts frames from 1', () => {
    expect(tickerLine('measure', 0, facts)).toBe('Frame 1 of 1192: camera position and depth')
    expect(tickerLine('measure', 1, facts)).toBe('Frame 1192 of 1192: camera position and depth')
  })
  it('counts pieces found, singular and plural', () => {
    expect(tickerLine('find', 1 / 34, facts)).toBe('Found 1 possible piece of furniture')
    expect(tickerLine('find', 1, facts)).toBe('Found 34 possible pieces of furniture')
  })
  it('names the piece being built', () => {
    expect(tickerLine('build', 0, facts)).toBe('Building the chair (1 of 7)')
    expect(tickerLine('build', 1, facts)).toBe('Building the armchair (7 of 7)')
  })
  it('ends the assembly on the physics result', () => {
    expect(tickerLine('assemble', 0.1, facts)).toBe('Testing all 34 candidates with physics')
    expect(tickerLine('assemble', 0.5, facts)).toBe('Clearing out 27 duplicates and false finds')
    expect(tickerLine('assemble', 0.9, facts)).toBe('Physics test passed: 7 pieces, nothing moved')
  })
  it('clamps progress outside 0..1', () => expect(tickerLine('upload', 2, facts)).toBe('Uploading lounge-walkthrough.mp4: 21.4 of 21.4 MB'))
})
