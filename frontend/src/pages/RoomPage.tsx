import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addObject, formatPrice, getRoom, listOrders, restoreLayout, saveLayout, undoRoom } from '../api'
import { errorText, orderedNames } from '../checkoutLogic'
import { findWarnings, warnedNames } from '../geometry'
import RoomScene from '../scene/RoomScene'
import { mergeServerObjects } from '../saveLogic'
import { acceptError, previewObject } from '../suggestLogic'
import type { Layout, Order, Room, RoomObject, Suggestion, Vec2 } from '../types'
import { useSaveQueue } from '../useSaveQueue'
import Alternatives from './Alternatives'
import Checkout from './Checkout'
import DesignPanel from './DesignPanel'
import DoorSize from './DoorSize'
import { ErrorCard, itemCount } from './Home'
import Layouts from './Layouts'
import RoomSize from './RoomSize'
import Shop from './Shop'
import Suggestions from './Suggestions'

const STEP = (15 * Math.PI) / 180

export default function RoomPage() {
  const { id = '' } = useParams()
  const [room, setRoom] = useState<Room | null>(null)
  const [objects, setObjects] = useState<RoomObject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tab, setTab] = useState<'room' | 'shop' | 'design' | 'checkout'>('room')
  const [adding, setAdding] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [designRunning, setDesignRunning] = useState(false) // the design agent saves on the server outside the save queue
  const [serverVersion, setServerVersion] = useState(0) // bumped whenever a server response is applied
  const draggingRef = useRef<string | null>(null)
  const resyncAfterDrag = useRef(false)
  const addingRef = useRef(false)
  const undoingRef = useRef(false)
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

  // Responses to saves and adds leave the room alone except for whether there is something to undo.
  const syncUndo = useCallback((r: Room) => {
    setRoom((cur) => (cur && cur.can_undo !== r.can_undo ? { ...cur, can_undo: r.can_undo } : cur))
  }, [])

  const onResult = useCallback((r: Room, pending: Set<string>) => {
    setSaveError(null)
    syncUndo(r)
    setObjects((local) => mergeServerObjects(local, r.objects, draggingRef.current, pending))
    setServerVersion((v) => v + 1)
  }, [syncUndo])

  // After a failed save, replace local state with the server's.
  // An add that finishes meanwhile returns the full room, so a reload that started before it is stale.
  const resync = useCallback(() => {
    const epoch = addEpoch.current
    getRoom(id).then(
      (r) => {
        setRoom(r)
        setServerVersion((v) => v + 1)
        if (epoch === addEpoch.current) {
          setObjects(r.objects)
          setSelected((s) => (s && r.objects.some((o) => o.name === s) ? s : null))
        }
        setSaveError("Couldn't save. Reloaded the room.")
      },
      (e: Error) => setSaveError(e.message),
    )
  }, [id])

  const { save, exclusive, working } = useSaveQueue(id, onResult, () => {
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
          syncUndo(r)
          setObjects((local) => mergeServerObjects(local, r.objects, draggingRef.current, pending(), r.added))
          setSelected(r.added)
          addEpoch.current++
          setServerVersion((v) => v + 1)
        } catch (e) {
          setSaveError((e as Error).message)
        } finally {
          addingRef.current = false
          replacingRef.current = null
          setAdding(false)
        }
      })
    },
    [id, exclusive, syncUndo],
  )

  // Place a suggestion exactly where it was previewed. Resolves to an error message, or null on success.
  const acceptSuggestion = useCallback(
    (s: Suggestion) =>
      new Promise<string | null>((resolve) => {
        if (addingRef.current) return resolve('Another piece is being added. Try again in a moment.')
        addingRef.current = true
        replacingRef.current = null
        setAdding(true)
        exclusive(async (pending) => {
          let failure: string | null = null
          try {
            const r = await addObject(id, s.catalog_id, undefined, { pos: s.pos, yaw: s.yaw })
            setSaveError(null)
            syncUndo(r)
            setObjects((local) => mergeServerObjects(local, r.objects, draggingRef.current, pending(), r.added))
            setSelected(r.added)
            addEpoch.current++
            setServerVersion((v) => v + 1)
            setSuggestions((list) => list.filter((x) => x.catalog_id !== s.catalog_id))
          } catch (e) {
            failure = acceptError(e)
          } finally {
            addingRef.current = false
            setAdding(false)
            resolve(failure)
          }
        })
      }),
    [id, exclusive, syncUndo],
  )

  // Replace the room with a server response that changed more than one piece.
  const applyRoom = useCallback((r: Room) => {
    setSaveError(null)
    setRoom(r)
    setObjects(r.objects)
    setSelected((s) => (s && r.objects.some((o) => o.name === s) ? s : null))
    addEpoch.current++
    setServerVersion((v) => v + 1)
  }, [])

  const undo = useCallback(() => {
    if (undoingRef.current) return
    undoingRef.current = true
    exclusive(async () => {
      try {
        applyRoom(await undoRoom(id))
      } catch (e) {
        setSaveError(errorText(e))
      } finally {
        undoingRef.current = false
      }
    })
  }, [id, exclusive, applyRoom])

  // Resolves to an error message, or null on success.
  const loadLayout = useCallback(
    (lid: string) =>
      new Promise<string | null>((resolve) => {
        exclusive(async () => {
          let failure: string | null = null
          try {
            applyRoom(await restoreLayout(id, lid))
          } catch (e) {
            failure = errorText(e)
          }
          resolve(failure)
        })
      }),
    [id, exclusive, applyRoom],
  )

  // Saves the room as it is once any pending drag has landed.
  const saveLayoutNow = useCallback(
    (name: string) =>
      new Promise<Layout[]>((resolve, reject) => {
        exclusive(async () => {
          try {
            resolve(await saveLayout(id, name))
          } catch (e) {
            reject(e)
          }
        })
      }),
    [id, exclusive],
  )

  const skipSuggestion = useCallback((s: Suggestion) => {
    setSuggestions((list) => list.filter((x) => x.catalog_id !== s.catalog_id))
  }, [])

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

  const canUndo = !!room?.can_undo

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
      if (typing || (t instanceof HTMLElement && t.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (!draggingRef.current && canUndo && !working && !designRunning) undo()
        return
      }
      if (t instanceof HTMLSelectElement || t instanceof HTMLButtonElement) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
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
  }, [selected, tab, save, updateObject, canUndo, working, designRunning, undo])

  const sizeXY = room?.room.size_xy
  const warned = useMemo(() => (sizeXY ? warnedNames(findWarnings(objects, sizeXY)) : new Set<string>()), [objects, sizeXY])
  const previews = useMemo(() => suggestions.map(previewObject), [suggestions])
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
          <ErrorCard message={error} backLink />
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
          previews={tab === 'shop' ? previews : undefined}
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
          <div className="panel-head">
            <h1 className="panel-title">{room.name}</h1>
            <button
              className="btn"
              disabled={!room.can_undo || working || designRunning || dragging !== null}
              title="Undo the last change (Ctrl+Z)"
              onClick={undo}
            >
              Undo
            </button>
          </div>
          <RoomSize room={room} itemCount={itemCount(visible.length)} onSaved={(r) => {
            setRoom(r)
            setServerVersion((v) => v + 1)
          }} />
          <DoorSize room={room} onSaved={setRoom} />
        </div>
        <div className="tabs">
          <button className={tab === 'room' ? 'on' : ''} onClick={() => setTab('room')}>Room</button>
          <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>Shop</button>
          <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>Design</button>
          <button className={tab === 'checkout' ? 'on' : ''} onClick={() => setTab('checkout')}>Checkout</button>
        </div>
        {saveError && <div className="save-error">{saveError}</div>}
        <div hidden={tab !== 'design'}>
          <DesignPanel
            roomId={id}
            onRunning={setDesignRunning}
            onRoom={(r) => {
              setRoom(r)
              setObjects(r.objects)
              setServerVersion((v) => v + 1)
            }}
          />
        </div>
        <div hidden={tab !== 'checkout'}>
          <Checkout roomId={id} orders={orders} setOrders={setOrders} />
        </div>
        <div hidden={tab !== 'shop'}>
          <Suggestions
            roomId={id}
            suggestions={suggestions}
            busy={adding}
            onSuggestions={setSuggestions}
            onAccept={acceptSuggestion}
            onSkip={skipSuggestion}
          />
        </div>
        {tab === 'shop' ? (
          <Shop room={room.room} door={room.door} objects={objects} target={replaceTarget} busy={adding} onAdd={addPiece} />
        ) : tab === 'checkout' || tab === 'design' ? null : (
          <>
          {selectedObj?.movable && selectedObj.product?.price != null && (
            <Alternatives
              roomId={id}
              piece={selectedObj}
              door={room.door}
              serverVersion={serverVersion}
              busy={adding}
              onSwap={(catalogId) => addPiece(catalogId, selectedObj.name)}
            />
          )}
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
          <Layouts roomId={id} busy={adding} onSave={saveLayoutNow} onLoad={loadLayout} />
          <p className="help">Drag to move · Q / E rotate · Delete removes · Ctrl+Z undoes · Esc deselects</p>
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
