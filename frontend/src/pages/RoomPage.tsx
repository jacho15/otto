import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addObject, formatPrice, getRoom, listOrders } from '../api'
import { orderedNames } from '../checkoutLogic'
import { findWarnings, warnedNames } from '../geometry'
import RoomScene from '../scene/RoomScene'
import { mergeServerObjects } from '../saveLogic'
import type { Order, Room, RoomObject, Vec2 } from '../types'
import { useSaveQueue } from '../useSaveQueue'
import Checkout from './Checkout'
import { ErrorCard, itemCount } from './Home'
import Shop from './Shop'

const STEP = (15 * Math.PI) / 180

export default function RoomPage() {
  const { id = '' } = useParams()
  const [room, setRoom] = useState<Room | null>(null)
  const [objects, setObjects] = useState<RoomObject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tab, setTab] = useState<'room' | 'shop' | 'checkout'>('room')
  const [adding, setAdding] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const draggingRef = useRef<string | null>(null)
  const resyncAfterDrag = useRef(false)
  const addingRef = useRef(false)
  const replacingRef = useRef<string | null>(null)
  const addEpoch = useRef(0)
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

  useEffect(() => {
    listOrders(id).then(setOrders, () => {})
  }, [id])

  const onResult = useCallback((r: Room, pending: Set<string>) => {
    setSaveError(null)
    setObjects((local) => mergeServerObjects(local, r.objects, draggingRef.current, pending))
  }, [])

  // After a failed save, replace local state with the server's.
  // An add that finishes meanwhile returns the full room, so a reload that started before it is stale.
  const resync = useCallback(() => {
    const epoch = addEpoch.current
    getRoom(id).then(
      (r) => {
        setRoom(r)
        if (epoch === addEpoch.current) {
          setObjects(r.objects)
          setSelected((s) => (s && r.objects.some((o) => o.name === s) ? s : null))
        }
        setSaveError("Couldn't save. Reloaded the room.")
      },
      (e: Error) => setSaveError(e.message),
    )
  }, [id])

  const { save, exclusive } = useSaveQueue(id, onResult, () => {
    if (draggingRef.current) resyncAfterDrag.current = true
    else resync()
  })

  const addPiece = useCallback(
    (catalogId: string, replace?: string) => {
      if (addingRef.current) return
      addingRef.current = true
      replacingRef.current = replace ?? null
      setAdding(true)
      exclusive(async (pending) => {
        try {
          const r = await addObject(id, catalogId, replace)
          setSaveError(null)
          setObjects((local) => mergeServerObjects(local, r.objects, draggingRef.current, pending(), r.added))
          setSelected(r.added)
          addEpoch.current++
        } catch (e) {
          setSaveError((e as Error).message)
        } finally {
          addingRef.current = false
          replacingRef.current = null
          setAdding(false)
        }
      })
    },
    [id, exclusive],
  )

  const updateObject = useCallback((name: string, patch: Partial<RoomObject>) => {
    setObjects((objs) => objs.map((o) => (o.name === name ? { ...o, ...patch } : o)))
  }, [])

  const onDragStart = useCallback((name: string) => {
    if (name === replacingRef.current) return
    draggingRef.current = name
    setDragging(name)
  }, [])

  const onDrag = useCallback(
    (name: string, pos: Vec2) => {
      if (name !== replacingRef.current) updateObject(name, { pos: [pos[0], pos[1], 0] })
    },
    [updateObject],
  )

  const onDragEnd = useCallback(
    (name: string, pos: Vec2 | null) => {
      draggingRef.current = null
      setDragging(null)
      if (resyncAfterDrag.current) {
        resyncAfterDrag.current = false
        resync()
      } else if (pos && name !== replacingRef.current && objectsRef.current.some((o) => o.name === name)) {
        save(name, { pos })
      }
    },
    [save, resync],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if (t instanceof HTMLButtonElement || (t instanceof HTMLElement && t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Escape') return setSelected(null)
      if (tab === 'checkout') return
      const obj = objectsRef.current.find((o) => o.name === selected)
      if (!obj || !obj.movable || obj.hidden || obj.name === replacingRef.current) return
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
  }, [selected, tab, save, updateObject])

  const sizeXY = room?.room.size_xy
  const warned = useMemo(() => (sizeXY ? warnedNames(findWarnings(objects, sizeXY)) : new Set<string>()), [objects, sizeXY])
  const visible = useMemo(() => objects.filter((o) => !o.hidden), [objects])
  const selectedObj = visible.find((o) => o.name === selected)
  const replaceTarget =
    selectedObj?.movable ? { name: selectedObj.name, title: selectedObj.product?.title ?? selectedObj.label } : null
  const ordered = useMemo(() => orderedNames(orders), [orders])
  const totalAmount = visible.reduce((sum, o) => sum + (o.product?.price ?? 0), 0)

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
            {room.room.size_xy[0]} × {room.room.size_xy[1]} m · {itemCount(visible.length)}
          </p>
        </div>
        <div className="tabs">
          <button className={tab === 'room' ? 'on' : ''} onClick={() => setTab('room')}>Room</button>
          <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>Shop</button>
          <button className={tab === 'checkout' ? 'on' : ''} onClick={() => setTab('checkout')}>Checkout</button>
        </div>
        {saveError && <div className="save-error">{saveError}</div>}
        <div hidden={tab !== 'checkout'}>
          <Checkout roomId={id} orders={orders} setOrders={setOrders} />
        </div>
        {tab === 'shop' ? (
          <Shop target={replaceTarget} busy={adding} onAdd={addPiece} />
        ) : tab === 'checkout' ? null : (
          <>
          <ul className="item-list">
            {visible.map((o) => (
              <li key={o.name}>
                <button
                  className={`item${o.name === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(o.name)}
                >
                  <span className="item-name">
                    {o.product?.title ?? o.label}
                    {o.replaces && (
                      <span className="item-note">Replaced: {replacedTitle(objects, o.replaces)}</span>
                    )}
                  </span>
                  <span className="item-meta">
                    {warned.has(o.name) && <span className="badge-warn">Check fit</span>}
                    {ordered.has(o.name) && <span className="badge-ok">Ordered (demo)</span>}
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
          </>
        )}
      </aside>
    </div>
  )
}

function replacedTitle(objects: RoomObject[], name: string) {
  const o = objects.find((x) => x.name === name)
  return o ? (o.product?.title ?? o.label) : name
}
