import { useEffect, useState, type FormEvent } from 'react'
import { deleteLayout, listLayouts } from '../api'
import { errorText } from '../checkoutLogic'
import { cheapestId } from '../layoutsLogic'
import type { Layout } from '../types'
import { totalLines } from '../moneyLogic'
import { itemCount } from './Home'
import MoneyLines from './MoneyLines'

interface Props {
  roomId: string
  busy: boolean
  /** Saves the current room as a layout once pending moves have landed. Resolves to the new list. */
  onSave: (name: string) => Promise<Layout[]>
  /** Replaces the room with a saved layout. Resolves to an error message, or null on success. */
  onLoad: (id: string) => Promise<string | null>
}

/** Save the current arrangement under a name, then flip between saved ones to compare. */
export default function Layouts({ roomId, busy, onSave, onLoad }: Props) {
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [name, setName] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listLayouts(roomId).then(setLayouts, (e) => setError(errorText(e)))
  }, [roomId])

  const run = async (job: () => Promise<void>) => {
    setWorking(true)
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setWorking(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    void run(async () => {
      setLayouts(await onSave(name.trim()))
      setName('')
    })
  }

  const load = (l: Layout) => {
    if (!window.confirm('Replace the current layout? You can undo.')) return
    void run(async () => {
      const failure = await onLoad(l.id)
      if (failure) setError(failure)
    })
  }

  const remove = (l: Layout) => run(async () => setLayouts(await deleteLayout(roomId, l.id)))

  const cheapest = cheapestId(layouts)
  const disabled = working || busy

  return (
    <section className="card checkout-card layouts">
      <h2 className="checkout-title">Layouts</h2>
      <form className="layouts-form" onSubmit={save}>
        <input
          className="liked-note"
          placeholder="Name this layout"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" type="submit" disabled={disabled || !name.trim()}>
          Save layout
        </button>
      </form>
      {error && <div className="save-error">{error}</div>}
      {layouts.length === 0 ? (
        <p className="muted">Save the room as it is now, then try another arrangement and compare.</p>
      ) : (
        <ul className="layout-list">
          {layouts.map((l) => (
            <li key={l.id} className="layout-row">
              <div className="layout-head">
                <span className="layout-name">
                  <strong>{l.name}</strong>
                  {l.id === cheapest && <span className="badge-ok">Cheapest</span>}
                </span>
                <MoneyLines className="item-price" lines={totalLines(l.totals, l.total)} />
              </div>
              <div className="layout-head">
                <span className="muted">{itemCount(l.count)}</span>
                <span className="layout-actions">
                  <button className="btn" disabled={disabled} onClick={() => load(l)}>Load</button>
                  <button className="btn" disabled={disabled} onClick={() => remove(l)}>Delete</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
