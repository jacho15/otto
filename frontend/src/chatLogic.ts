import type { DesignChange } from './types'

const VERB = { placed: 'Placed', moved: 'Moved', removed: 'Removed' } as const

/** "Placed LACK Coffee table" */
export function changeLine(c: DesignChange): string {
  return `${VERB[c.action] ?? 'Changed'} ${c.title}`
}
