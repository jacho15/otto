import { ApiError } from './api'
import { errorText } from './checkoutLogic'
import type { RoomObject, Suggestion } from './types'

/** A suggestion as a hidden (ghost) room object, so it can be drawn like a piece. Never saved. */
export function previewObject(s: Suggestion): RoomObject {
  return {
    name: `suggestion-${s.catalog_id}`,
    label: s.label,
    mesh: s.model ? `catalog/${s.model}` : null,
    shape: s.shape,
    pos: [s.pos[0], s.pos[1], 0],
    yaw: s.yaw,
    size: s.size,
    movable: false,
    rgba: s.rgba,
    hidden: true,
    catalog_id: s.catalog_id,
  }
}

/** Text for a failed accept: the server's message, or a fixed one for a taken spot. */
export function acceptError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409 && typeof e.detail !== 'string') return 'That spot is no longer free.'
  return errorText(e)
}
