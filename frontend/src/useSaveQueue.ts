import { useCallback, useRef } from 'react'
import { deleteObject, patchObject } from './api'
import { drainQueue, queueChange } from './saveLogic'
import type { Change } from './saveLogic'
import type { Room } from './types'

export type { Change }

/**
 * Sends saves one at a time. Only the latest pending change per object is kept.
 * onResult gets each response plus the names that still have changes queued.
 * onFail runs after a failed save; the caller should reload the room.
 */
export function useSaveQueue(
  roomId: string,
  onResult: (room: Room, pending: Set<string>) => void,
  onFail: (e: Error) => void,
) {
  const pending = useRef(new Map<string, Change>())
  const busy = useRef(false)
  const callbacks = useRef({ onResult, onFail })
  callbacks.current = { onResult, onFail }

  const run = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      await drainQueue(
        pending.current,
        (name, change) =>
          change.remove
            ? deleteObject(roomId, name)
            : patchObject(roomId, name, { pos: change.pos, yaw: change.yaw }),
        (room, names) => callbacks.current.onResult(room, names),
        (e) => callbacks.current.onFail(e),
      )
    } finally {
      busy.current = false
    }
  }, [roomId])

  return useCallback(
    (name: string, change: Change) => {
      queueChange(pending.current, name, change)
      void run()
    },
    [run],
  )
}
