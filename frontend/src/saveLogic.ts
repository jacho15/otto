import type { Room, RoomObject, Vec2 } from './types'

export interface Change {
  pos?: Vec2
  yaw?: number
  remove?: boolean
}

/** Queue a change. Latest value per object wins, and a delete beats everything. */
export function queueChange(pending: Map<string, Change>, name: string, change: Change) {
  const cur = pending.get(name)
  pending.set(name, change.remove || cur?.remove ? { remove: true } : { ...cur, ...change })
}

/**
 * Send queued changes one at a time. On a failure the rest of the queue is
 * dropped and onFail is called, so the caller can reload the room.
 */
export async function drainQueue(
  pending: Map<string, Change>,
  send: (name: string, change: Change) => Promise<Room>,
  onResult: (room: Room, pending: Set<string>) => void,
  onFail: (e: Error) => void,
) {
  while (pending.size > 0) {
    const [name, change] = pending.entries().next().value!
    pending.delete(name)
    try {
      onResult(await send(name, change), new Set(pending.keys()))
    } catch (e) {
      pending.clear()
      onFail(e as Error)
    }
  }
}

/**
 * Merge a server response into local objects. Local order and membership win,
 * so an object deleted locally stays gone. A piece being dragged or with a
 * newer save queued keeps its local state.
 */
export function mergeServerObjects(
  local: RoomObject[],
  server: RoomObject[],
  dragging: string | null,
  pending: Set<string>,
): RoomObject[] {
  const byName = new Map(server.map((o) => [o.name, o]))
  return local.map((mine) => {
    const theirs = byName.get(mine.name)
    return !theirs || mine.name === dragging || pending.has(mine.name) ? mine : theirs
  })
}
