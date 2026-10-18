import { useEffect, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { agentCheckout, approveOrder, cancelOrder, deleteMandate, formatPrice, getMandate, putMandate } from '../api'
import { CURRENCIES, currentViolations, defaultExpiry, errorText, mandateSummary, parseLimit, parseShops, tokenLabel, violationsOf } from '../checkoutLogic'
import { totalLines } from '../moneyLogic'
import type { Mandate, Order } from '../types'
import MoneyLines from './MoneyLines'

interface Props {
  roomId: string
  orders: Order[]
  setOrders: Dispatch<SetStateAction<Order[]>>
}

const DEFAULT_INSTRUCTION = 'Buy the furniture in this room within my limits.'

const upsert = (orders: Order[], o: Order) =>
  orders.some((x) => x.id === o.id) ? orders.map((x) => (x.id === o.id ? o : x)) : [o, ...orders]

export default function Checkout({ roomId, orders, setOrders }: Props) {
  const [mandate, setMandate] = useState<Mandate | null | undefined>(undefined) // undefined: loading
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Order | null>(null)

  useEffect(() => {
    getMandate().then(setMandate, (e: Error) => setError(errorText(e)))
  }, [])

  const proposed = orders.find((o) => o.status === 'proposed')

  return (
    <div className="checkout">
      {error && <div className="save-error">{error}</div>}
      {mandate === undefined ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          <MandateCard mandate={mandate} onChange={setMandate} />
          <AskCard
            roomId={roomId}
            mandate={mandate}
            onOrder={(o) => {
              setReceipt(null)
              setOrders((prev) => upsert(prev, o))
            }}
          />
          {proposed && mandate && (
            <ProposedCard
              key={proposed.id}
              roomId={roomId}
              order={proposed}
              mandate={mandate}
              onUpdate={(o) => setOrders((prev) => upsert(prev, o))}
              onApproved={setReceipt}
            />
          )}
          {receipt?.payment && <Receipt order={receipt} />}
          <History orders={orders} />
        </>
      )}
    </div>
  )
}

function MandateCard({ mandate, onChange }: { mandate: Mandate | null; onChange: (m: Mandate | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [maxItem, setMaxItem] = useState('')
  const [maxTotal, setMaxTotal] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [shops, setShops] = useState('ikea.com')
  const [expires, setExpires] = useState(defaultExpiry())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showForm = editing || mandate === null

  const startEdit = () => {
    if (mandate) {
      setMaxItem(mandate.max_item_price == null ? '' : String(mandate.max_item_price))
      setMaxTotal(mandate.max_total == null ? '' : String(mandate.max_total))
      setCurrency(mandate.currency ?? 'USD')
      setShops(mandate.shops.join(', '))
      setExpires(mandate.expires ?? '')
    }
    setError(null)
    setEditing(true)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const max_item_price = parseLimit(maxItem)
    const max_total = parseLimit(maxTotal)
    const shopList = parseShops(shops)
    if (max_item_price === undefined || max_total === undefined) return setError('Limits must be numbers of 0 or more.')
    if (shopList.length === 0) return setError('Add at least one shop.')
    setBusy(true)
    setError(null)
    try {
      onChange(await putMandate({ max_item_price, max_total, shops: shopList, expires: expires || null, currency }))
      setEditing(false)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    if (!window.confirm('Revoke the agent token? The agent will not be able to buy anything.')) return
    setBusy(true)
    setError(null)
    try {
      await deleteMandate()
      onChange(null)
      setEditing(false)
      setMaxItem('')
      setMaxTotal('')
      setCurrency('USD')
      setShops('ikea.com')
      setExpires(defaultExpiry())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card checkout-card">
      <h2 className="checkout-title">Spend mandate</h2>
      {showForm ? (
        <form className="checkout-form" onSubmit={save}>
          {mandate === null && <p className="muted">The agent can't buy anything until you set limits.</p>}
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(CURRENCIES.includes(currency) ? CURRENCIES : [...CURRENCIES, currency]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Max price per item ({currency})
            <input type="number" min="0" step="any" placeholder="No limit" value={maxItem} onChange={(e) => setMaxItem(e.target.value)} />
          </label>
          <label>
            Max order total ({currency})
            <input type="number" min="0" step="any" placeholder="No limit" value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} />
          </label>
          <label>
            Allowed shops (comma separated)
            <input type="text" value={shops} onChange={(e) => setShops(e.target.value)} />
          </label>
          <label>
            Expires
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          {error && <div className="save-error">{error}</div>}
          <div className="checkout-actions">
            <button className="btn primary" type="submit" disabled={busy}>Save</button>
            {mandate && (
              <button className="btn" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            )}
          </div>
        </form>
      ) : (
        mandate && (
          <>
            <ul className="checkout-summary">
              {mandateSummary(mandate).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="muted">{tokenLabel(mandate.token_last4)}</p>
            {error && <div className="save-error">{error}</div>}
            <div className="checkout-actions">
              <button className="btn" disabled={busy} onClick={startEdit}>Edit</button>
              <button className="btn" disabled={busy} onClick={revoke}>Revoke</button>
            </div>
          </>
        )
      )}
    </section>
  )
}

function AskCard({ roomId, mandate, onOrder }: { roomId: string; mandate: Mandate | null; onOrder: (o: Order) => void }) {
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ask = async () => {
    setRunning(true)
    setMessage(null)
    setError(null)
    try {
      const r = await agentCheckout(roomId, instruction)
      setMessage(r.message)
      if (r.order) onOrder(r.order)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="card checkout-card">
      <h2 className="checkout-title">Ask the agent</h2>
      {!mandate && <p className="muted">Set a spend mandate first.</p>}
      <textarea
        className="checkout-text"
        rows={3}
        value={instruction}
        disabled={!mandate || running}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <button className="btn primary" disabled={!mandate || running || !instruction.trim()} onClick={ask}>
        Ask agent
      </button>
      {running && <p className="muted">Agent is preparing your order…</p>}
      {error && <div className="save-error">{error}</div>}
      {message && <blockquote className="agent-quote">{message}</blockquote>}
    </section>
  )
}

function ProposedCard({
  roomId,
  order,
  mandate,
  onUpdate,
  onApproved,
}: {
  roomId: string
  order: Order
  mandate: Mandate
  onUpdate: (o: Order) => void
  onApproved: (o: Order) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState<{ mandate: Mandate; list: string[] } | null>(null) // a 409 on approve

  useEffect(() => {
    if (!confirming) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, busy])

  const lines = totalLines(order.totals, { amount: order.total, currency: order.currency })
  const total = lines.join(' + ')
  const current = currentViolations(order.items, mandate)
  const serverViolations = rejected?.mandate === mandate ? rejected.list : null // stale once the limits change

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      const o = await approveOrder(roomId, order.id)
      setConfirming(false)
      onUpdate(o)
      onApproved(o)
    } catch (err) {
      setConfirming(false)
      const v = violationsOf(err)
      if (v) setRejected({ mandate, list: v })
      else setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    setError(null)
    try {
      onUpdate(await cancelOrder(roomId, order.id))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card checkout-card">
      <h2 className="checkout-title">Proposed order</h2>
      <ul className="order-items">
        {order.items.map((item) => (
          <li key={item.object_name}>
            <div className="shop-head">
              {/^https?:\/\//i.test(item.url) ? (
                <a className="shop-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
              ) : (
                <span>{item.title}</span>
              )}
              <span className="item-price">{formatPrice(item.price, item.currency)}</span>
            </div>
            <p className="muted order-reason">{item.reason}</p>
          </li>
        ))}
      </ul>
      <div className="total checkout-total">
        <span>Total</span>
        <strong><MoneyLines lines={lines} /></strong>
      </div>
      {current.length > 0 && (
        <>
          <ul className="violations">
            {current.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
          <p className="muted">Raise your limits or ask the agent again.</p>
        </>
      )}
      {serverViolations && (
        <ul className="violations">
          {serverViolations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
      {error && <div className="save-error">{error}</div>}
      <div className="checkout-actions">
        <button className="btn primary" disabled={busy || current.length > 0} onClick={() => setConfirming(true)}>
          Approve {total}
        </button>
        <button className="btn" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
      {confirming && (
        <div className="modal-backdrop">
          <div className="card modal" role="dialog" aria-modal="true" aria-label="Confirm demo payment">
            <p>
              Approve a demo payment of {total} to {mandate.shops.join(', ')} with agent token •••• {mandate.token_last4}?
              No real money will move.
            </p>
            <div className="checkout-actions">
              <button className="btn primary" disabled={busy} onClick={approve}>Approve</button>
              <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Receipt({ order }: { order: Order }) {
  const p = order.payment!
  return (
    <section className="card checkout-card">
      <h2 className="checkout-title">Demo authorization</h2>
      <dl className="receipt">
        <dt>Auth ID</dt>
        <dd>{p.auth_id}</dd>
        <dt>Amount</dt>
        <dd>{formatPrice(p.amount, p.currency)}</dd>
        <dt>Token</dt>
        <dd>•••• {p.token_last4}</dd>
      </dl>
      <p className="muted">{p.note}</p>
    </section>
  )
}

function History({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return null
  return (
    <section className="card checkout-card">
      <h2 className="checkout-title">Order history</h2>
      <ul className="order-history">
        {orders.map((o) => (
          <li key={o.id}>
            <span className="muted">{new Date(o.created_at).toLocaleDateString()}</span>
            <span className={`order-status ${o.status}`}>{o.status}</span>
            <MoneyLines className="item-price" lines={totalLines(o.totals, { amount: o.total, currency: o.currency })} />
          </li>
        ))}
      </ul>
    </section>
  )
}
