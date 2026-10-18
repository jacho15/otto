import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { agentDesign, getRoom, listSaved } from '../api'
import { errorText } from '../checkoutLogic'
import type { DesignResult, Room } from '../types'

interface Props {
  roomId: string
  onRoom: (room: Room) => void
}

const DEFAULT_INSTRUCTION = 'Lay out my liked pieces in this place, and suggest what else it needs.'

const VERB = { placed: 'Placed', moved: 'Moved', removed: 'Removed' } as const

export default function DesignPanel({ roomId, onRoom }: Props) {
  const [likedCount, setLikedCount] = useState<number | null>(null)
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Pick<DesignResult, 'message' | 'changes'> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listSaved().then((s) => setLikedCount(s.length), () => setLikedCount(null))
  }, [])

  const design = async () => {
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const r = await agentDesign(roomId, instruction)
      setResult({ message: r.message, changes: r.changes })
      onRoom(r.room)
    } catch (err) {
      // The agent may have saved changes before it failed, so refresh the room.
      let text = errorText(err)
      try {
        onRoom(await getRoom(roomId))
        text += ' Some changes may have been saved.'
      } catch {
        // Keep the original error.
      }
      setError(text)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="checkout">
      <section className="card checkout-card">
        <h2 className="checkout-title">Design with Claude</h2>
        <p className="muted">
          {likedCount === null ? 'Liked pieces' : `${likedCount} liked ${likedCount === 1 ? 'piece' : 'pieces'}`}
          {' · '}
          <Link className="text-link" to="/liked">Liked at the showroom</Link>
        </p>
        <textarea
          className="checkout-text"
          rows={4}
          value={instruction}
          disabled={running}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="btn primary" disabled={running || !instruction.trim()} onClick={design}>
          {running ? 'Claude is designing your place…' : 'Design with Claude'}
        </button>
        {error && <div className="save-error">{error}</div>}
        {result && (
          <>
            <blockquote className="agent-quote">{result.message}</blockquote>
            {result.changes.length > 0 && (
              <ul className="change-list">
                {result.changes.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    {VERB[c.action]} {c.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  )
}
