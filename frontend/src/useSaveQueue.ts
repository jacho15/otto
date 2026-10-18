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
 * exclusive runs a job once every queued save is sent, and holds later saves
 * until it finishes, so its response can't overwrite a pending move. The job
 * gets a function that returns the names with changes queued.
 */
export function useSaveQueue(
  roomId: string,
  onResult: (room: Room, pending: Set<string>) => void,
  onFail: (e: Error) => void,
) {
  const pending = useRef(new Map<string, Change>())
  const jobs = useRef<((pending: () => Set<string>) => Promise<void>)[]>([])
  const busy = useRef(false)
  const callbacks = useRef({ onResult, onFail })
  callbacks.current = { onResult, onFail }

  const run = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      while (pending.current.size > 0 || jobs.current.length > 0) {
        if (pending.current.size > 0) {
          await drainQueue(
            pending.current,
            (name, change) =>
              change.remove
                ? deleteObject(roomId, name)
                : patchObject(roomId, name, { pos: change.pos, yaw: change.yaw }),
            (room, names) => callbacks.current.onResult(room, names),
            (e) => callbacks.current.onFail(e),
          )
        } else {
          await jobs.current.shift()!(() => new Set(pending.current.keys()))
        }
      }
    } finally {
      busy.current = false
    }
  }, [roomId])

  const save = useCallback(
    (name: string, change: Change) => {
      queueChange(pending.current, name, change)
      void run()
    },
    [run],
  )

  const exclusive = useCallback(
    (job: (pending: () => Set<string>) => Promise<void>) => {
      jobs.current.push(job)
      void run()
    },
    [run],
  )

  return { save, exclusive }
}
