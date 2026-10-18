import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { formatPrice, getCatalog, listSaved, saveItem, unsaveItem } from '../api'
import { errorText } from '../checkoutLogic'
import { FIT_TEXT, SORT_TEXT, productFit, sortItems, type Fit, type SortKey } from '../shopLogic'
import type { CatalogItem, Door, RoomObject, RoomShape, SavedItem } from '../types'
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
  const [saved, setSaved] = useState<SavedItem[] | null>(null)
  const [likeBusy, setLikeBusy] = useState(false)
  const [likeError, setLikeError] = useState<string | null>(null)

  useEffect(() => {
    getCatalog().then(setItems, (e: Error) => setError(e.message))
    listSaved().then(setSaved, (e: Error) => setLikeError(errorText(e)))
  }, [])

  // Like or unlike a piece. The liked list is the same in every room.
  const toggleLike = async (id: string, liked: boolean) => {
    setLikeBusy(true)
    setLikeError(null)
    try {
      setSaved(await (liked ? unsaveItem(id) : saveItem(id)))
    } catch (err) {
      setLikeError(errorText(err))
    } finally {
      setLikeBusy(false)
    }
  }

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
  const likedIds = useMemo(() => new Set((saved ?? []).map((s) => s.catalog_id)), [saved])

  if (error) return <div className="save-error">{error}</div>
  if (!items) return <p className="muted">Loading shop…</p>
  if (items.length === 0) return <p className="muted">No products yet.</p>

  const fitCount = items.filter((i) => fits.get(i.id) === 'fits').length
  const likedShown = shown.filter((i) => likedIds.has(i.id))
  const restShown = shown.filter((i) => !likedIds.has(i.id))

  const card = (item: CatalogItem) => {
    const fit = fits.get(item.id) ?? 'fits'
    const liked = likedIds.has(item.id)
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
            <button
              className="btn"
              aria-pressed={liked}
              disabled={likeBusy || saved === null}
              onClick={() => toggleLike(item.id, liked)}
            >
              {liked ? '♥ Liked' : '♡ Like'}
            </button>
          </div>
        </div>
      </li>
    )
  }

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
      {likeError && <div className="save-error">{likeError}</div>}
      {likedShown.length > 0 && (
        <>
          <h3 className="checkout-title">Your liked pieces</h3>
          <ul className="shop-list">{likedShown.map(card)}</ul>
          {restShown.length > 0 && <h3 className="checkout-title">More pieces</h3>}
        </>
      )}
      <ul className="shop-list">{restShown.map(card)}</ul>
    </>
  )
}
