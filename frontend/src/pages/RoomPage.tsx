import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatPrice, getRoom } from '../api'
import { findWarnings, warnedNames } from '../geometry'
import RoomScene from '../scene/RoomScene'
import { mergeServerObjects } from '../saveLogic'
import type { Room, RoomObject, Vec2 } from '../types'
import { useSaveQueue } from '../useSaveQueue'
import { ErrorCard, itemCount } from './Home'

const STEP = (15 * Math.PI) / 180

export default function RoomPage() {
  const { id = '' } = useParams()
  const [room, setRoom] = useState<Room | null>(null)
  const [objects, setObjects] = useState<RoomObject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const draggingRef = useRef<string | null>(null)
  const resyncAfterDrag = useRef(false)
  const objectsRef = useRef(objects)
  objectsRef.current = objects

  useEffect(() => {
    getRoom(id).then(
      (r) => {
        setRoom(r)
        setObjects(r.objects)
      },
      (e: Error) => setError(e.message),
    )
  }, [id])

  const onResult = useCallback((r: Room, pending: Set<string>) => {
    setSaveError(null)
    setObjects((local) => mergeServerObjects(local, r.objects, draggingRef.current, pending))
  }, [])

  // After a failed save, replace local state with the server's.
  const resync = useCallback(() => {
    getRoom(id).then(
      (r) => {
        setRoom(r)
        setObjects(r.objects)
        setSaveError("Couldn't save. Reloaded the room.")
      },
      (e: Error) => setSaveError(e.message),
    )
  }, [id])

  const save = useSaveQueue(id, onResult, () => {
    if (draggingRef.current) resyncAfterDrag.current = true
    else resync()
  })

  const updateObject = useCallback((name: string, patch: Partial<RoomObject>) => {
    setObjects((objs) => objs.map((o) => (o.name === name ? { ...o, ...patch } : o)))
  }, [])

  const onDragStart = useCallback((name: string) => {
    draggingRef.current = name
    setDragging(name)
  }, [])

  const onDrag = useCallback(
    (name: string, pos: Vec2) => updateObject(name, { pos: [pos[0], pos[1], 0] }),
    [updateObject],
  )

  const onDragEnd = useCallback(
    (name: string, pos: Vec2 | null) => {
      draggingRef.current = null
      setDragging(null)
      if (resyncAfterDrag.current) {
        resyncAfterDrag.current = false
        resync()
      } else if (pos && objectsRef.current.some((o) => o.name === name)) save(name, { pos })
    },
    [save, resync],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') return setSelected(null)
      const obj = objectsRef.current.find((o) => o.name === selected)
      if (!obj || !obj.movable) return
      const key = e.key.toLowerCase()
      if (key === 'q' || key === 'e') {
        const yaw = obj.yaw + (key === 'q' ? -STEP : STEP)
        updateObject(obj.name, { yaw })
        save(obj.name, { yaw })
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (draggingRef.current) return
        setObjects((objs) => objs.filter((o) => o.name !== obj.name))
        setSelected(null)
        save(obj.name, { remove: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, save, updateObject])

  const sizeXY = room?.room.size_xy
  const warned = useMemo(() => (sizeXY ? warnedNames(findWarnings(objects, sizeXY)) : new Set<string>()), [objects, sizeXY])
  const totalAmount = objects.reduce((sum, o) => sum + (o.product?.price ?? 0), 0)

  if (error) {
    return (
      <div className="home">
        <header className="topbar">
          <Link to="/" className="wordmark">otto</Link>
        </header>
        <main className="home-main">
          <ErrorCard message={error} />
        </main>
      </div>
    )
  }

  if (!room) return <div className="center-note muted">Loading room…</div>

  return (
    <div className="room-page">
      <div className="viewport">
        <RoomScene
          room={room}
          objects={objects}
          selected={selected}
          warned={warned}
          dragging={dragging !== null}
          onSelect={setSelected}
          onDragStart={onDragStart}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
        />
      </div>
      <aside className="panel">
        <Link to="/" className="wordmark">otto</Link>
        <div>
          <h1 className="panel-title">{room.name}</h1>
          <p className="muted">
            {room.room.size_xy[0]} × {room.room.size_xy[1]} m · {itemCount(objects.length)}
          </p>
        </div>
        {saveError && <div className="save-error">{saveError}</div>}
        <ul className="item-list">
          {objects.map((o) => (
            <li key={o.name}>
              <button
                className={`item${o.name === selected ? ' selected' : ''}`}
                onClick={() => setSelected(o.name)}
              >
                <span className="item-name">{o.product?.title ?? o.label}</span>
                <span className="item-meta">
                  {warned.has(o.name) && <span className="badge-warn">Check fit</span>}
                  {o.product && (
                    <span className="item-price">{o.product.price == null ? '—' : formatPrice(o.product.price, o.product.currency)}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="total">
          <span>Total</span>
          <strong>{formatPrice(totalAmount, room.total.currency)}</strong>
        </div>
        <p className="help">Drag to move · Q / E rotate · Delete removes · Esc deselects</p>
      </aside>
    </div>
  )
}
