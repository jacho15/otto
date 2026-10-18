import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createRoom, listRooms } from '../api'
import { errorText } from '../checkoutLogic'
import { checkDimension, rangeText } from '../placeLogic'
import type { Unit } from '../placeLogic'
import type { RoomSummary } from '../types'
import YourData from './YourData'

export default function Home() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listRooms().then(setRooms, (e: Error) => setError(e.message))
  }, [])

  return (
    <div className="home">
      <header className="topbar">
        <span className="wordmark">otto</span>
      </header>
      <main className="home-main">
        <h1>Your rooms</h1>
        <p className="muted">Pick a room to rearrange it in 3D.</p>
        <p className="home-links">
          <Link className="text-link" to="/liked">Liked at the showroom</Link>
        </p>
        {error && <ErrorCard message={error} />}
        {!rooms && !error && <p className="muted">Loading rooms…</p>}
        {rooms && rooms.length === 0 && <p className="muted">No rooms yet.</p>}
        {rooms && rooms.length > 0 && (
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link className="card room-card" to={`/rooms/${encodeURIComponent(r.id)}`}>
                  <span className="room-card-title">
                    <span className="room-card-name">{r.name}</span>
                    {r.kind === 'blueprint' && <span className="badge-tag">Blueprint</span>}
                  </span>
                  <span className="muted">
                    {r.size_xy[0]} × {r.size_xy[1]} m · {itemCount(r.object_count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <NewPlace />
        <p className="home-links">
          <YourData />
        </p>
      </main>
    </div>
  )
}

function NewPlace() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<Unit>('m')
  const [width, setWidth] = useState('')
  const [depth, setDepth] = useState('')
  const [height, setHeight] = useState('2.5')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchUnit = (u: Unit) => {
    setUnit(u)
    setError(null)
    setHeight(u === 'ft' ? '8' : '2.5')
    setWidth('')
    setDepth('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Give the place a name.')
    const w = checkDimension('width', width, unit)
    const d = checkDimension('depth', depth, unit)
    const h = checkDimension('height', height, unit)
    if ('error' in w) return setError(w.error)
    if ('error' in d) return setError(d.error)
    if ('error' in h) return setError(h.error)
    setBusy(true)
    setError(null)
    try {
      const room = await createRoom({ name: name.trim(), width: w.metres, depth: d.metres, height: h.metres })
      navigate(`/rooms/${encodeURIComponent(room.id)}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <section className="card new-place">
      <h2 className="checkout-title">New place</h2>
      <p className="muted">Make an empty blueprint from its size, then lay out the pieces you like.</p>
      <form className="checkout-form" onSubmit={submit}>
        <label>
          Name
          <input type="text" value={name} maxLength={60} placeholder="New apartment" onChange={(e) => setName(e.target.value)} />
        </label>
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
            Ceiling height ({unit})
            <input type="number" step="any" placeholder={rangeText('height', unit)} value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
        </div>
        {error && <div className="save-error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create place'}
        </button>
      </form>
    </section>
  )
}

export function itemCount(n: number) {
  return `${n} ${n === 1 ? 'item' : 'items'}`
}

export function ErrorCard({ message, backLink = false }: { message: string; backLink?: boolean }) {
  return (
    <div className="card error-card">
      <strong>Something went wrong</strong>
      <p>
        {message}
        {message === 'Cannot reach the Otto server.' && ' Check that the backend is running on port 8000, then reload.'}
      </p>
      {backLink && <Link className="text-link" to="/">Back to rooms</Link>}
    </div>
  )
}
