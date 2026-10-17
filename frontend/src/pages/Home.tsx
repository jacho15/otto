import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRooms } from '../api'
import type { RoomSummary } from '../types'

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
        {error && <ErrorCard message={error} />}
        {!rooms && !error && <p className="muted">Loading rooms…</p>}
        {rooms && rooms.length === 0 && <p className="muted">No rooms yet.</p>}
        {rooms && rooms.length > 0 && (
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link className="card room-card" to={`/rooms/${encodeURIComponent(r.id)}`}>
                  <span className="room-card-name">{r.name}</span>
                  <span className="muted">
                    {r.size_xy[0]} × {r.size_xy[1]} m · {itemCount(r.object_count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

export function itemCount(n: number) {
  return `${n} ${n === 1 ? 'item' : 'items'}`
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card error-card">
      <strong>Something went wrong</strong>
      <p>{message} Check that the backend is running on port 8000, then reload.</p>
    </div>
  )
}
