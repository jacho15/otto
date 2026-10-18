import { useEffect, useState } from 'react'
import { formatPrice, getAlternatives } from '../api'
import { savingsText } from '../alternativesLogic'
import { errorText } from '../checkoutLogic'
import type { AlternativesResult, RoomObject } from '../types'
import ShopPhoto from './ShopPhoto'

interface Props {
  roomId: string
  piece: RoomObject
  /** Changes each time a server response is applied; a change can alter what fits. */
  serverVersion: number
  busy: boolean
  onSwap: (catalogId: string) => void
}

type Loaded = { name: string; result?: AlternativesResult; error?: string }

export default function Alternatives({ roomId, piece, serverVersion, busy, onSwap }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const { name } = piece

  // Refetch once the server has confirmed a change. Wait a moment so quick changes share one request. Drop any answer that arrives late.
  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      getAlternatives(roomId, name).then(
        (result) => !stale && setLoaded({ name, result }),
        (e) => !stale && setLoaded({ name, error: errorText(e) }),
      )
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [roomId, name, serverVersion])

  const current = loaded?.name === name ? loaded : null
  const title = piece.product?.title ?? piece.label

  return (
    <section className="card checkout-card alternatives">
      <h2 className="checkout-title">Cheaper options for {title}</h2>
      {!current && <p className="muted">Looking for cheaper options…</p>}
      {current?.error && <div className="save-error">{current.error}</div>}
      {current?.result && current.result.alternatives.length === 0 && (
        <p className="muted">Nothing cheaper of this type in the catalog.</p>
      )}
      {current?.result && current.result.alternatives.length > 0 && (
        <ul className="shop-list">
          {current.result.alternatives.map((a) => (
            <li key={a.id} className="alt-row">
              <ShopPhoto item={a} />
              <div className="alt-info">
                <div className="shop-head">
                  <strong>{a.title}</strong>
                  <span className="item-price">{formatPrice(a.price, a.currency)}</span>
                </div>
                <p className="alt-save">{savingsText(a.savings, a.savings_pct, a.currency)}</p>
                {a.fits ? (
                  <p className="shop-size">
                    <span className="badge-ok">Fits here</span>
                  </p>
                ) : (
                  <ul className="violations shop-size">
                    {a.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
                <a className="shop-link" href={a.url} target="_blank" rel="noopener noreferrer">
                  View at IKEA
                </a>
                <button className="btn primary" disabled={!a.fits || busy} onClick={() => onSwap(a.id)}>
                  Swap in
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
