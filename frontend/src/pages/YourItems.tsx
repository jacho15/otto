import { useState } from 'react'
import { deleteCustomItem, formatPrice } from '../api'
import { errorText } from '../checkoutLogic'
import type { CustomItem } from '../types'
import ShopPhoto from './ShopPhoto'

interface Props {
  items: CustomItem[]
  /** A piece is being added to the room. */
  busy: boolean
  onAdd: (catalogId: string) => void
  onItems: (items: CustomItem[]) => void
}

const cm = (m: number) => Math.round(m * 100)

/** The furniture the user has added themselves, ready to place again. */
export default function YourItems({ items, busy, onAdd, onItems }: Props) {
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (item: CustomItem) => {
    setRemoving(item.id)
    setError(null)
    try {
      onItems(await deleteCustomItem(item.id))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="checkout">
      <h2 className="checkout-title">Your items</h2>
      {items.length === 0 && <p className="muted">Nothing here yet. Furniture you add yourself will show up here.</p>}
      {error && <div className="save-error">{error}</div>}
      <ul className="shop-list">
        {items.map((item) => (
          <li key={item.id} className="card your-item">
            <ShopPhoto item={item} />
            <div className="alt-info">
              <div className="shop-head">
                <strong>{item.title}</strong>
                <span className="item-price">{item.price == null ? '—' : formatPrice(item.price, item.currency)}</span>
              </div>
              <p className="muted shop-size">
                {cm(item.size[0])} × {cm(item.size[1])} × {cm(item.size[2])} cm
              </p>
              <div className="layout-actions">
                <button className="btn primary" disabled={busy} onClick={() => onAdd(item.id)}>
                  Add to room
                </button>
                <button className="btn" disabled={removing !== null} onClick={() => remove(item)}>
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
