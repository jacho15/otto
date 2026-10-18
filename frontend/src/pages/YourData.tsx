import { useEffect, useState } from 'react'
import { deleteData, getData } from '../api'
import { errorText } from '../checkoutLogic'
import type { DataSummary } from '../types'

/** Extra line in the confirm box for kinds whose delete has a side effect. */
const CONFIRM_NOTES: Record<string, string> = {
  orders: 'Deleting orders also forgets which pieces were bought, so they can be ordered again.',
  custom: 'Pieces from your items that are already in rooms will lose their 3D model and photo.',
}

interface Props {
  /** Called after a kind was deleted, so the page can refresh what it shows. */
  onDeleted?: (kind: string) => void
}

/** A "Your data" link that opens a list of what is stored, each with a Delete button. */
export default function YourData({ onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<DataSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    setSummary(null)
    setError(null)
    getData().then(
      (s) => current && setSummary(s),
      (e) => current && setError(errorText(e)),
    )
    return () => {
      current = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])

  const remove = async (kind: string, label: string, count: number) => {
    const extra = CONFIRM_NOTES[kind] ? ` ${CONFIRM_NOTES[kind]}` : ''
    if (!window.confirm(`Delete ${label} (${count})? This cannot be undone.${extra}`)) return
    setBusy(true)
    setError(null)
    try {
      setSummary(await deleteData(kind))
      onDeleted?.(kind)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="text-link data-link" onClick={() => setOpen(true)}>Your data</button>
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="card modal data-dialog" role="dialog" aria-modal="true" aria-label="Your data" onClick={(e) => e.stopPropagation()}>
            <h2 className="checkout-title">Your data</h2>
            {error && <div className="save-error">{error}</div>}
            {!summary && !error && <p className="muted">Loading…</p>}
            {summary && (
              <>
                <ul className="data-list">
                  {summary.items.map((item) => (
                    <li key={item.kind} className="data-row">
                      <span>
                        <strong>{item.label}</strong> · {item.count}
                        <span className="item-note">{item.detail}</span>
                      </span>
                      <button className="btn" disabled={busy || item.count === 0} onClick={() => remove(item.kind, item.label, item.count)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="muted">{summary.note}</p>
              </>
            )}
            <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
