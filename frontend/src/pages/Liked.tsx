import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { catalogFileUrl, formatPrice, getCatalog, listSaved, saveItem, unsaveItem } from '../api'
import { errorText } from '../checkoutLogic'
import type { CatalogItem, SavedItem } from '../types'

const cm = (m: number) => Math.round(m * 100)

export default function Liked() {
  const [saved, setSaved] = useState<SavedItem[] | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedError, setSavedError] = useState<string | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  useEffect(() => {
    listSaved().then(setSaved, (e: Error) => setSavedError(errorText(e)))
    getCatalog().then(setCatalog, (e: Error) => setCatalogError(errorText(e)))
  }, [])

  const run = async (task: () => Promise<SavedItem[]>) => {
    setBusy(true)
    setError(null)
    try {
      setSaved(await task())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const likedIds = new Set((saved ?? []).map((s) => s.catalog_id))

  return (
    <div className="home">
      <header className="topbar">
        <Link to="/" className="wordmark">otto</Link>
      </header>
      <main className="home-main liked-main">
        <h1>Liked at the showroom</h1>
        <p className="muted">Scan pieces you like at the showroom. For now, pick them from the catalog.</p>
        {error && <div className="save-error">{error}</div>}

        {savedError && <div className="save-error">{savedError}</div>}
        {!saved && !savedError && <p className="muted">Loading…</p>}
        {saved && saved.length === 0 && <p className="muted">Nothing liked yet.</p>}
        {saved && saved.length > 0 && (
          <ul className="liked-grid">
            {saved.map(({ catalog_id, note, item }) => (
              <li key={catalog_id} className="card shop-card">
                <img className="shop-photo" src={catalogFileUrl(item.photo)} alt={item.title} loading="lazy" />
                <div className="shop-info">
                  <div className="shop-head">
                    <strong>{item.title}</strong>
                    <span className="item-price">{formatPrice(item.price, item.currency)}</span>
                  </div>
                  <p className="muted shop-size">
                    {cm(item.size[0])} × {cm(item.size[1])} × {cm(item.size[2])} cm
                  </p>
                  {note && <p className="item-note">{note}</p>}
                  <div className="shop-actions">
                    <button className="btn" disabled={busy} onClick={() => run(() => unsaveItem(catalog_id))}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <h2 className="checkout-title">Add from the catalog</h2>
        {catalogError && <div className="save-error">{catalogError}</div>}
        {!catalog && !catalogError && <p className="muted">Loading catalog…</p>}
        {catalog && (
          <ul className="liked-grid">
            {catalog.map((item) => {
              const liked = likedIds.has(item.id)
              return (
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
                    {!liked && (
                      <input
                        className="liked-note"
                        type="text"
                        placeholder="Note (optional)"
                        maxLength={200}
                        value={notes[item.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                      />
                    )}
                    <div className="shop-actions">
                      <button
                        className="btn primary"
                        disabled={busy || liked || saved === null}
                        onClick={() => run(() => saveItem(item.id, notes[item.id]?.trim()))}
                      >
                        {liked ? '♥ Liked' : '♡ Like'}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
