import { useState, type FormEvent } from 'react'
import { setDoor } from '../api'
import { checkDimension, fromMetres, rangeText, toMetres } from '../placeLogic'
import type { Unit } from '../placeLogic'
import type { Room } from '../types'

interface Props {
  room: Room
  onSaved: (room: Room) => void
}

const cm = (m: number) => Math.round(m * 100)

/** "Door 81 × 203 cm" with an Edit form for the doorway that furniture has to come through. */
export default function DoorSize({ room, onSaved }: Props) {
  const { width: W, height: H } = room.door
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState<Unit>('m')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = () => {
    setUnit('m')
    setWidth(String(fromMetres(W, 'm')))
    setHeight(String(fromMetres(H, 'm')))
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
    convert(height, setHeight)
    setUnit(u)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const w = checkDimension('doorWidth', width, unit)
    const h = checkDimension('doorHeight', height, unit)
    if ('error' in w) return setError(w.error)
    if ('error' in h) return setError(h.error)
    setBusy(true)
    setError(null)
    try {
      onSaved(await setDoor(room.id, { width: w.metres, height: h.metres }))
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <p className="muted room-size door-size">
        Door {cm(W)} × {cm(H)} cm{' '}
        <button className="text-link" onClick={open}>Edit door</button>
      </p>
    )
  }

  return (
    <form className="checkout-form room-size-form" onSubmit={submit}>
      <p className="muted">Type the doorway's size. The shop uses it to check what fits through.</p>
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
          Door width ({unit})
          <input type="number" step="any" placeholder={rangeText('doorWidth', unit)} value={width} onChange={(e) => setWidth(e.target.value)} />
        </label>
        <label>
          Door height ({unit})
          <input type="number" step="any" placeholder={rangeText('doorHeight', unit)} value={height} onChange={(e) => setHeight(e.target.value)} />
        </label>
      </div>
      {error && <div className="save-error">{error}</div>}
      <div className="shop-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save door'}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
