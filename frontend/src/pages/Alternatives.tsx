import { useEffect, useRef, useState } from 'react'
import { createCustomItem, formatPrice, getAlternatives, searchIkea, searchShops } from '../api'
import {
  customItemFor,
  estimatedSizeText,
  ikeaButtonText,
  ikeaSavingsText,
  savingsText,
  shopButtonText,
  shopLinkText,
  sizeCmText,
} from '../alternativesLogic'
import { errorText } from '../checkoutLogic'
import type {
  AlternativesResult,
  CustomItem,
  Door,
  IkeaAlternative,
  IkeaResult,
  RoomObject,
  ShopAlternative,
  ShopResult,
} from '../types'
import DoorBadge from './DoorBadge'
import ShopPhoto from './ShopPhoto'

interface Props {
  roomId: string
  piece: RoomObject
  door: Door
  /** Changes each time a server response is applied; a change can alter what fits. */
  serverVersion: number
  busy: boolean
  onSwap: (catalogId: string) => void
  /** Called with the custom item that an IKEA or shop swap saved, so lists of custom items can show it. */
  onItemSaved?: (item: CustomItem) => void
}

type Loaded = { name: string; result?: AlternativesResult; error?: string }
type IkeaLoaded = { name: string; result?: IkeaResult; error?: string }
type ShopsLoaded = { name: string; result?: ShopResult; error?: string }

/** The photo of an IKEA or shop product, or a plain tile with the label's first letter when there is none or it fails to load. */
function IkeaPhoto({ item }: { item: IkeaAlternative | ShopAlternative }) {
  const [failed, setFailed] = useState(false)
  if (!item.image_url || failed) {
    return (
      <div className="shop-photo placeholder" role="img" aria-label={item.title}>
        {item.label.charAt(0).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      className="shop-photo"
      src={item.image_url}
      alt={item.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

export default function Alternatives({ roomId, piece, door, serverVersion, busy, onSwap, onItemSaved }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [ikea, setIkea] = useState<IkeaLoaded | null>(null)
  const [searching, setSearching] = useState<string | null>(null) // name of the piece being searched for
  const [shops, setShops] = useState<ShopsLoaded | null>(null)
  const [searchingShops, setSearchingShops] = useState<string | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState<{ section: 'ikea' | 'shops'; text: string } | null>(null)
  const { name } = piece
  const selected = useRef(name) // the piece that is selected now, for answers that arrive late
  const hasPrice = piece.product?.price != null

  // A new piece starts without the swap error of the old one.
  useEffect(() => {
    selected.current = name
    setSwapError(null)
  }, [name])

  // Refetch once the server has confirmed a change. Wait a moment so quick changes share one request. Drop any answer that arrives late.
  useEffect(() => {
    if (!hasPrice) return
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
  }, [roomId, name, hasPrice, serverVersion])

  // The IKEA search takes 20 to 45 seconds. An answer for a piece that is no longer selected is dropped.
  const search = () => {
    setSearching(name)
    setSwapError(null)
    searchIkea(roomId, name)
      .then(
        (result) => selected.current === name && setIkea({ name, result }),
        (e) => selected.current === name && setIkea({ name, error: errorText(e) }),
      )
      .finally(() => setSearching((s) => (s === name ? null : s)))
  }

  // Same for the shop search, which takes about 10 to 30 seconds.
  const searchOtherShops = () => {
    setSearchingShops(name)
    setSwapError(null)
    searchShops(roomId, name)
      .then(
        (result) => selected.current === name && setShops({ name, result }),
        (e) => selected.current === name && setShops({ name, error: errorText(e) }),
      )
      .finally(() => setSearchingShops((s) => (s === name ? null : s)))
  }

  // An IKEA or shop piece is not in the catalog: save it as a custom item, then replace the piece with it as for a catalog swap.
  const swapFound = async (a: IkeaAlternative | ShopAlternative, section: 'ikea' | 'shops') => {
    setSwapping(true)
    setSwapError(null)
    try {
      const item = await createCustomItem(customItemFor(a))
      onItemSaved?.(item)
      onSwap(item.id)
    } catch (e) {
      if (selected.current === name) setSwapError({ section, text: errorText(e) })
    } finally {
      setSwapping(false)
    }
  }

  const current = loaded?.name === name ? loaded : null
  const found = ikea?.name === name ? ikea : null
  const waiting = searching === name
  const foundShops = shops?.name === name ? shops : null
  const waitingShops = searchingShops === name
  const title = piece.product?.title ?? piece.label

  return (
    <section className="card checkout-card alternatives">
      <h2 className="checkout-title">
        {hasPrice ? 'Cheaper options for' : 'Similar options for'} {title}
      </h2>
      {hasPrice && !current && <p className="muted">Looking for cheaper options…</p>}
      {hasPrice && current?.error && <div className="save-error">{current.error}</div>}
      {hasPrice && current?.result && current.result.alternatives.length === 0 && (
        <p className="muted">Nothing cheaper of this type in the catalog.</p>
      )}
      {hasPrice && current?.result && current.result.alternatives.length > 0 && (
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
                    <span className="badge-ok">Fits here</span> <DoorBadge size={a.size} door={door} />
                  </p>
                ) : (
                  <>
                    <ul className="violations shop-size">
                      {a.problems.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                    <p className="shop-size">
                      <DoorBadge size={a.size} door={door} />
                    </p>
                  </>
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
      <button className="btn" disabled={waiting} onClick={() => search()}>
        {ikeaButtonText(hasPrice, waiting)}
      </button>
      {waiting && <p className="muted">This can take up to a minute.</p>}
      {found?.error && <div className="save-error">{found.error}</div>}
      {swapError?.section === 'ikea' && <div className="save-error">{swapError.text}</div>}
      {found?.result && (
        <>
          <p className="muted">{found.result.message}</p>
          {found.result.alternatives.length > 0 && (
            <>
              <ul className="shop-list">
                {found.result.alternatives.map((a) => {
                  const save = ikeaSavingsText(a.savings, a.savings_pct, a.currency)
                  return (
                    <li key={a.id} className="alt-row">
                      <IkeaPhoto item={a} />
                      <div className="alt-info">
                        <div className="shop-head">
                          <a className="shop-link" href={a.url} target="_blank" rel="noopener noreferrer">
                            <strong>{a.title}</strong>
                          </a>
                          <span className="item-price">
                            {a.price === null ? 'No price listed' : formatPrice(a.price, a.currency)}
                          </span>
                        </div>
                        {save && <p className="alt-save">{save}</p>}
                        <p className="shop-size">{sizeCmText(a.size)}</p>
                        {a.fits ? (
                          <p className="shop-size">
                            <span className="badge-ok">Fits here</span> <DoorBadge size={a.size} door={door} />
                          </p>
                        ) : (
                          <>
                            <ul className="violations shop-size">
                              {a.problems.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                            <p className="shop-size">
                              <DoorBadge size={a.size} door={door} />
                            </p>
                          </>
                        )}
                        <p className="muted shop-size">{a.why}</p>
                        <button
                          className="btn primary"
                          disabled={!a.fits || busy || swapping}
                          onClick={() => swapFound(a, 'ikea')}
                        >
                          Swap in
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="muted">
                Prices and sizes are read from the IKEA pages. A swapped-in piece shows as a plain box of its size.
              </p>
            </>
          )}
        </>
      )}
      <button className="btn" disabled={waitingShops} onClick={() => searchOtherShops()}>
        {shopButtonText(waitingShops)}
      </button>
      {waitingShops && <p className="muted">This can take up to a minute.</p>}
      {foundShops?.error && <div className="save-error">{foundShops.error}</div>}
      {swapError?.section === 'shops' && <div className="save-error">{swapError.text}</div>}
      {foundShops?.result && (
        <>
          <p className="muted">{foundShops.result.message}</p>
          {foundShops.result.alternatives.length > 0 && (
            <>
              <ul className="shop-list">
                {foundShops.result.alternatives.map((a) => {
                  const save = ikeaSavingsText(a.savings, a.savings_pct, a.currency)
                  return (
                    <li key={a.id} className="alt-row">
                      <IkeaPhoto item={a} />
                      <div className="alt-info">
                        <div className="shop-head">
                          <a className="shop-link" href={a.url} target="_blank" rel="noopener noreferrer">
                            <strong>{a.title}</strong>
                          </a>
                          <span className="item-price">{formatPrice(a.price, a.currency)}</span>
                        </div>
                        <p className="muted shop-size">
                          {a.shop} ·{' '}
                          <a className="shop-link" href={a.url} target="_blank" rel="noopener noreferrer">
                            {shopLinkText(a.url, a.shop)}
                          </a>
                        </p>
                        {save && <p className="alt-save">{save}</p>}
                        <p className="shop-size">{estimatedSizeText(a.size)}</p>
                        {a.fits ? (
                          <p className="shop-size">
                            <span className="badge-ok">Fits here</span> <DoorBadge size={a.size} door={door} />
                          </p>
                        ) : (
                          <>
                            <ul className="violations shop-size">
                              {a.problems.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                            <p className="shop-size">
                              <DoorBadge size={a.size} door={door} />
                            </p>
                          </>
                        )}
                        <p className="muted shop-size">{a.why}</p>
                        <button
                          className="btn primary"
                          disabled={!a.fits || busy || swapping}
                          onClick={() => swapFound(a, 'shops')}
                        >
                          Swap in
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="muted">
                Links open Google Shopping. Prices are as listed there, not checked on the shop's page, and sizes are
                estimated from the listing. A swapped-in piece shows as a plain box of its size.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}
