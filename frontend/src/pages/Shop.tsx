import { useEffect, useState } from 'react'
import { catalogFileUrl, formatPrice, getCatalog } from '../api'
import type { CatalogItem } from '../types'

interface Props {
  /** The selected piece that Replace would swap out, if any. */
  target: { name: string; title: string } | null
  busy: boolean
  onAdd: (catalogId: string, replace?: string) => void
}

const cm = (m: number) => Math.round(m * 100)

export default function Shop({ target, busy, onAdd }: Props) {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCatalog().then(setItems, (e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="save-error">{error}</div>
  if (!items) return <p className="muted">Loading shop…</p>
  if (items.length === 0) return <p className="muted">No products yet.</p>

  return (
    <ul className="shop-list">
      {items.map((item) => (
        <li key={item.id} className="card shop-card">
          <img className="shop-photo" src={catalogFileUrl(item.photo)} alt={item.title} loading="lazy" />
          <div className="shop-info">
            <div className="shop-head">
              <strong>{item.title}</strong>
              <span className="item-price">{formatPrice(item.price, item.currency)}</span>
            </div>
            <p className="muted shop-size">
              {cm(item.size[0])} × {cm(item.size[1])} × {cm(item.size[2])} cm
            </p>
            <a className="shop-link" href={item.url} target="_blank" rel="noopener noreferrer">
              View at IKEA
            </a>
            <div className="shop-actions">
              <button className="btn primary" disabled={busy} onClick={() => onAdd(item.id)}>
                Add to room
              </button>
              {target && (
                <button className="btn" disabled={busy} onClick={() => onAdd(item.id, target.name)}>
                  Replace {target.title}
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
