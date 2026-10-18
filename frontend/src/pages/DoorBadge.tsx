import { DOOR_TEXT, DOOR_TITLE, fitsThroughDoor } from '../shopLogic'
import type { Door, Vec3 } from '../types'

/** Whether a piece of this size gets through the doorway, with a hint that it is an estimate. */
export default function DoorBadge({ size, door }: { size: Vec3; door: Door }) {
  const ok = fitsThroughDoor(size, door)
  return (
    <span className={ok ? 'badge-ok' : 'badge-warn'} title={DOOR_TITLE}>
      {ok ? DOOR_TEXT.yes : DOOR_TEXT.no}
    </span>
  )
}
