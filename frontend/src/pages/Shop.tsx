import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { formatPrice, getCatalog } from '../api'
import { FIT_TEXT, SORT_TEXT, productFit, sortItems, type Fit, type SortKey } from '../shopLogic'
import type { CatalogItem, Door, RoomObject, RoomShape } from '../types'
import DoorBadge from './DoorBadge'
import ShopPhoto from './ShopPhoto'

interface Props {
  room: RoomShape
  door: Door
  objects: RoomObject[]
  /** The selected piece that Replace would swap out, if any. */
  target: { name: string; title: string } | null
  busy: boolean
  onAdd: (catalogId: string, replace?: string) => void
}

const cm = (m: number) => Math.round(m * 100)

export default function Shop({ room, door, objects, target, busy, onAdd }: Props) {
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('fit')
  const [onlyFits, setOnlyFits] = useState(false)

  useEffect(() => {
    getCatalog().then(setItems, (e: Error) => setError(e.message))
  }, [])

  // Recheck fit as the room changes, but let a drag in progress stay smooth.
  const liveObjects = useDeferredValue(objects)
  const fits = useMemo(
    () => new Map<string, Fit>((items ?? []).map((i) => [i.id, productFit(i.size, room, liveObjects)])),
    [items, room, liveObjects],
  )
  const shown = useMemo(() => {
    const sorted = sortItems(items ?? [], fits, sort)
    return onlyFits ? sorted.filter((i) => fits.get(i.id) === 'fits') : sorted
  }, [items, fits, sort, onlyFits])

  if (error) return <div className="save-error">{error}</div>
  if (!items) return <p className="muted">Loading shop…</p>
  if (items.length === 0) return <p className="muted">No products yet.</p>

  const fitCount = items.filter((i) => fits.get(i.id) === 'fits').length

  return (
    <>
      <div className="shop-tools">
        <span className="muted">
          {fitCount} of {items.length} fit this room
        </span>
        <label className="shop-only">
          <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />
          Only what fits
        </label>
        <label className="shop-sort">
          <span className="muted">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_TEXT) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_TEXT[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 && <p className="muted">Nothing in the shop fits the free space. Try Replace on a piece, or edit the room size.</p>}
      <ul className="shop-list">
        {shown.map((item) => {
          const fit = fits.get(item.id) ?? 'fits'
          return (
            <li key={item.id} className="card shop-card">
              <ShopPhoto item={item} />
              <div className="shop-info">
                <div className="shop-head">
                  <strong>{item.title}</strong>
                  <span className="item-price">{formatPrice(item.price, item.currency)}</span>
                </div>
                <p className="muted shop-size">
                  {cm(item.size[0])} × {cm(item.size[1])} × {cm(item.size[2])} cm{' '}
                  <span className={fit === 'fits' ? 'badge-ok' : 'badge-warn'}>{FIT_TEXT[fit]}</span>{' '}
                  <DoorBadge size={item.size} door={door} />
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
          )
        })}
      </ul>
    </>
  )
}
