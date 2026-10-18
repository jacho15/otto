import { useRef, useState } from 'react'
import { agentSuggest, formatPrice } from '../api'
import { errorText } from '../checkoutLogic'
import type { Suggestion } from '../types'
import ShopPhoto from './ShopPhoto'

interface Props {
  roomId: string
  suggestions: Suggestion[]
  busy: boolean
  onSuggestions: (list: Suggestion[]) => void
  /** Resolves to an error message, or null when the piece was placed. */
  onAccept: (s: Suggestion) => Promise<string | null>
  onSkip: (s: Suggestion) => void
}

const cm = (m: number) => Math.round(m * 100)

export default function Suggestions({ roomId, suggestions, busy, onSuggestions, onAccept, onSkip }: Props) {
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const current = useRef(suggestions)
  current.current = suggestions

  const suggest = async () => {
    setRunning(true)
    setError(null)
    try {
      const r = await agentSuggest(roomId, instruction.trim())
      setMessage(r.message)
      setCardErrors({})
      onSuggestions(r.suggestions)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setRunning(false)
    }
  }

  const accept = async (s: Suggestion) => {
    setCardErrors(({ [s.catalog_id]: _, ...rest }) => rest)
    const failure = await onAccept(s)
    if (failure) setCardErrors((c) => ({ ...c, [s.catalog_id]: failure }))
  }

  const acceptAll = async () => {
    setAccepting(true)
    for (const s of suggestions) {
      if (current.current.some((x) => x.catalog_id === s.catalog_id)) await accept(s)
    }
    setAccepting(false)
  }

  const clear = () => {
    onSuggestions([])
    setMessage(null)
    setCardErrors({})
  }

  const locked = busy || accepting

  return (
    <div className="checkout suggestions">
      <section className="card checkout-card">
        <h2 className="checkout-title">Goes well with your room</h2>
        <input
          className="checkout-text"
          value={instruction}
          disabled={running}
          placeholder="Anything in mind? e.g. cozy reading corner"
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="btn primary" disabled={running || locked} onClick={suggest}>
          {running ? 'Claude is picking pieces…' : 'Suggest with Claude'}
        </button>
        {error && <div className="save-error">{error}</div>}
        {message && <blockquote className="agent-quote">{message}</blockquote>}
        {(suggestions.length > 0 || message) && (
          <div className="suggest-bar">
            {suggestions.length > 1 && (
              <button className="btn" disabled={locked} onClick={acceptAll}>
                Accept all
              </button>
            )}
            <button className="text-link suggest-clear" disabled={accepting} onClick={clear}>
              Clear
            </button>
          </div>
        )}
      </section>
      {suggestions.length > 0 && (
        <ul className="shop-list">
          {suggestions.map((s) => (
            <li key={s.catalog_id} className="card shop-card">
              <ShopPhoto item={s} />
              <div className="shop-info">
                <div className="shop-head">
                  <strong>{s.title}</strong>
                  <span className="item-price">{formatPrice(s.price, s.currency)}</span>
                </div>
                <p className="muted shop-size">
                  {cm(s.size[0])} × {cm(s.size[1])} × {cm(s.size[2])} cm
                </p>
                <p className="muted shop-size">{s.reason}</p>
                {s.mandate_ok ? (
                  <p className="shop-size">
                    <span className="badge-ok">Within your limits</span>
                  </p>
                ) : (
                  <ul className="violations shop-size">
                    {s.violations.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                )}
                {cardErrors[s.catalog_id] && <div className="save-error">{cardErrors[s.catalog_id]}</div>}
                <div className="shop-actions">
                  <button className="btn primary" disabled={locked} onClick={() => accept(s)}>
                    Accept
                  </button>
                  <button className="btn" disabled={accepting} onClick={() => onSkip(s)}>
                    Skip
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
