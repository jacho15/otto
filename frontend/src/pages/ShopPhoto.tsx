import { catalogFileUrl } from '../api'
import type { CatalogItem } from '../types'

/** The product photo, or a plain tile with the label's first letter when there is none. */
export default function ShopPhoto({ item }: { item: Pick<CatalogItem, 'title' | 'label' | 'photo'> }) {
  if (!item.photo) {
    return (
      <div className="shop-photo placeholder" role="img" aria-label={item.title}>
        {item.label.charAt(0).toUpperCase()}
      </div>
    )
  }
  return <img className="shop-photo" src={catalogFileUrl(item.photo)} alt={item.title} loading="lazy" />
}
