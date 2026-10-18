import { useState, type FormEvent } from 'react'
import { setRoomSize } from '../api'
import { checkDimension, fromMetres, rangeText, toMetres } from '../placeLogic'
import type { Unit } from '../placeLogic'
import type { Room } from '../types'

interface Props {
  room: Room
  itemCount: string
  onSaved: (room: Room) => void
}

const m2 = (v: number) => String(Math.round(v * 100) / 100)

/** "5 × 4 m · ceiling 2.6 m" with an Edit size form for typing the room's measured size. */
export default function RoomSize({ room, itemCount, onSaved }: Props) {
  const [W, D] = room.room.size_xy
  const H = room.room.ceiling_height
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState<Unit>('m')
  const [width, setWidth] = useState('')
  const [depth, setDepth] = useState('')
  const [height, setHeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fill = (u: Unit) => {
    setWidth(String(fromMetres(W, u)))
    setDepth(String(fromMetres(D, u)))
    setHeight(String(fromMetres(H, u)))
  }

  const open = () => {
    setUnit('m')
    fill('m')
    setError(null)
    setEditing(true)
  }

  // Convert what's typed so far instead of clearing it.
  const switchUnit = (u: Unit) => {
    if (u === unit) return
    const convert = (text: string, setter: (v: string) => void) => {
      const v = Number(text)
      if (text.trim() !== '' && Number.isFinite(v)) setter(String(fromMetres(toMetres(v, unit), u)))
    }
    convert(width, setWidth)
    convert(depth, setDepth)
    convert(height, setHeight)
    setUnit(u)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const w = checkDimension('width', width, unit)
    const d = checkDimension('depth', depth, unit)
    const h = checkDimension('height', height, unit)
    if ('error' in w) return setError(w.error)
    if ('error' in d) return setError(d.error)
    if ('error' in h) return setError(h.error)
    setBusy(true)
    setError(null)
    try {
      onSaved(await setRoomSize(room.id, { width: w.metres, depth: d.metres, height: h.metres }))
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <p className="muted room-size">
        {m2(W)} × {m2(D)} m · ceiling {m2(H)} m · {itemCount}{' '}
        <button className="text-link" onClick={open}>Edit size</button>
      </p>
    )
  }

  return (
    <form className="checkout-form room-size-form" onSubmit={submit}>
      <p className="muted">Type the room's measured size. Furniture stays where it is.</p>
      <div className="unit-toggle" role="group" aria-label="Unit">
        <span className="muted">Unit</span>
        {(['m', 'ft'] as const).map((u) => (
          <button key={u} type="button" className={unit === u ? 'on' : ''} onClick={() => switchUnit(u)}>
            {u}
          </button>
        ))}
      </div>
      <div className="new-place-row">
        <label>
          Width ({unit})
          <input type="number" step="any" placeholder={rangeText('width', unit)} value={width} onChange={(e) => setWidth(e.target.value)} />
        </label>
        <label>
          Depth ({unit})
          <input type="number" step="any" placeholder={rangeText('depth', unit)} value={depth} onChange={(e) => setDepth(e.target.value)} />
        </label>
        <label>
          Ceiling ({unit})
          <input type="number" step="any" placeholder={rangeText('height', unit)} value={height} onChange={(e) => setHeight(e.target.value)} />
        </label>
      </div>
      {error && <div className="save-error">{error}</div>}
      <div className="shop-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save size'}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
