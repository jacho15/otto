// The scan demo replays a real reconstruction on a fixed clock: five steps, each with its own length.
// Everything the page shows (ring, step, picture, ticker) is derived from elapsed time, so it can be tested.

export type StepKey = 'upload' | 'measure' | 'find' | 'build' | 'assemble'

export interface DemoStep {
  key: StepKey
  title: string
  blurb: string
  ms: number
}

export const STEPS: DemoStep[] = [
  { key: 'upload', title: 'Uploading your video', blurb: 'The clip goes to a GPU server that does the heavy lifting.', ms: 5000 },
  { key: 'measure', title: 'Measuring the room', blurb: 'For every frame: where the phone was, and how far away everything is.', ms: 8000 },
  { key: 'find', title: 'Finding the furniture', blurb: 'Every sofa, chair, table and lamp is picked out and followed through the video.', ms: 7000 },
  { key: 'build', title: 'Building each piece in 3D', blurb: 'One good view of each piece becomes a full 3D model, back and sides included.', ms: 10500 },
  { key: 'assemble', title: 'Putting the room together', blurb: 'The pieces go into one room, get a physics test, and duplicates are cleared out.', ms: 7500 },
]

export const TOTAL_MS = STEPS.reduce((sum, s) => sum + s.ms, 0)

export interface Moment {
  /** Index of the current step, 0-based. Equals STEPS.length when done. */
  index: number
  /** How far through the current step, 0..1. */
  stepProgress: number
  /** How far through the whole replay, 0..1. */
  overall: number
  done: boolean
}

export function timelineAt(elapsedMs: number): Moment {
  const t = Math.max(0, elapsedMs)
  if (t >= TOTAL_MS) return { index: STEPS.length, stepProgress: 1, overall: 1, done: true }
  let start = 0
  for (let i = 0; i < STEPS.length; i++) {
    const end = start + STEPS[i].ms
    if (t < end) return { index: i, stepProgress: (t - start) / STEPS[i].ms, overall: t / TOTAL_MS, done: false }
    start = end
  }
  return { index: STEPS.length, stepProgress: 1, overall: 1, done: true }
}

/** Which of `count` items to show at progress p (0..1), never past the last one. */
export function itemAt(p: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.floor(p * count)))
}

export interface DemoFacts {
  fileName: string
  uploadMb: number
  frames: number
  candidates: number
  kept: number
  pieces: string[] // labels of the pieces that end up in the room, in build order
}

/** One plain line saying what the server is doing right now. */
export function tickerLine(key: StepKey, p: number, f: DemoFacts): string {
  const q = Math.min(1, Math.max(0, p))
  switch (key) {
    case 'upload':
      return `Uploading ${f.fileName}: ${(q * f.uploadMb).toFixed(1)} of ${f.uploadMb} MB`
    case 'measure':
      return `Frame ${Math.max(1, Math.round(q * f.frames))} of ${f.frames}: camera position and depth`
    case 'find': {
      const n = Math.round(q * f.candidates)
      return `Found ${n} possible ${n === 1 ? 'piece' : 'pieces'} of furniture`
    }
    case 'build': {
      const i = itemAt(q, f.pieces.length)
      return `Building the ${f.pieces[i] ?? 'piece'} (${i + 1} of ${f.pieces.length})`
    }
    case 'assemble':
      if (q < 0.4) return `Testing all ${f.candidates} candidates with physics`
      if (q < 0.7) return `Clearing out ${f.candidates - f.kept} duplicates and false finds`
      return `Physics test passed: ${f.kept} pieces, nothing moved`
  }
}
