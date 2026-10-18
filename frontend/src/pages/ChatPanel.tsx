import { useEffect, useRef, useState } from 'react'
import { clearChat, deletePref, getChat } from '../api'
import { changeLine } from '../chatLogic'
import { errorText } from '../checkoutLogic'
import type { ChatMessage, ChatReply } from '../types'

interface Props {
  roomId: string
  /** True while this tab is showing, so the list can scroll to the bottom. */
  active: boolean
  /** Sends the text and applies the returned room. */
  onSend: (text: string) => Promise<ChatReply>
  /** Called with true while a request is running. */
  onRunning: (running: boolean) => void
}

const EXAMPLES = [
  'Add a cheap coffee table in front of the sofa',
  'Find a cheaper armchair that fits',
  'I want a Scandinavian look under $600',
]

export default function ChatPanel({ roomId, active, onSend, onRunning }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prefs, setPrefs] = useState<string[]>([])
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const request = useRef(0) // counts sends; a reply whose number is out of date is dropped
  const sentSinceLoad = useRef(false) // a send started before getChat resolved
  const refocus = useRef(false)

  useEffect(() => {
    let current = true
    request.current++ // drops a reply that is still in flight for the previous room
    sentSinceLoad.current = false
    setLoaded(false)
    setMessages([])
    setPrefs([])
    setError(null)
    setText('')
    setRunning(false)
    getChat(roomId).then(
      (c) => {
        if (!current) return
        if (!sentSinceLoad.current) setMessages(c.messages)
        setPrefs(c.prefs)
        setLoaded(true)
      },
      (e) => {
        if (!current) return
        setError(errorText(e))
        setLoaded(true)
      },
    )
    return () => {
      current = false
    }
  }, [roomId])

  useEffect(() => {
    onRunning(running)
  }, [running, onRunning])

  useEffect(() => {
    if (active && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages, running, active])

  useEffect(() => {
    if (!running && refocus.current) {
      refocus.current = false
      input.current?.focus()
    }
  }, [running])

  const send = async (body: string) => {
    const msg = body.trim()
    if (!msg || running) return
    const token = ++request.current
    sentSinceLoad.current = true
    setRunning(true)
    setError(null)
    setText('')
    setMessages((m) => [...m, { role: 'user', text: msg }])
    try {
      const r = await onSend(msg)
      if (token !== request.current) return
      setMessages((m) => [...m, { role: 'assistant', text: r.reply, changes: r.changes }])
      setPrefs(r.prefs)
    } catch (e) {
      if (token !== request.current) return
      // Take the message back out and keep the text, so it can be sent again.
      setMessages((m) => m.slice(0, -1))
      setText((t) => t || msg)
      setError(errorText(e))
    }
    refocus.current = true
    setRunning(false)
  }

  const newChat = async () => {
    if (!window.confirm('Start a new chat? The conversation is cleared. Your preferences stay.')) return
    setError(null)
    try {
      const c = await clearChat(roomId)
      setMessages(c.messages)
      setPrefs(c.prefs)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const removePref = async (index: number) => {
    setError(null)
    try {
      setPrefs((await deletePref(roomId, index)).prefs)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="checkout">
      <section className="card checkout-card">
        <div className="chat-head">
          <h2 className="checkout-title">Chat with Otto</h2>
          {messages.length > 0 && (
            <button className="text-link chat-link" disabled={running} onClick={newChat}>New chat</button>
          )}
        </div>
        <div className="chat-list" ref={list}>
          {loaded && messages.length === 0 && !running && (
            <div className="chat-empty">
              <p className="muted">Ask Otto to change your room. Try:</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="btn chat-example" onClick={() => send(ex)}>{ex}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-bubble">{m.text}</div>
              {m.changes && m.changes.length > 0 && (
                <ul className="chat-changes">
                  {m.changes.map((c, j) => (
                    <li key={`${c.name}-${j}`}>{changeLine(c)}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {running && <div className="chat-thinking muted">Otto is thinking…</div>}
        </div>
        {error && <div className="save-error">{error}</div>}
        {prefs.length > 0 && (
          <ul className="chat-prefs">
            {prefs.map((p, i) => (
              <li key={`${p}-${i}`} className="chat-pref">
                {p}
                <button aria-label={`Remove ${p}`} disabled={running} onClick={() => removePref(i)}>×</button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="checkout-text"
          rows={3}
          maxLength={2000}
          ref={input}
          placeholder="Ask Otto to change your room"
          value={text}
          disabled={running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send(text)
            }
          }}
        />
        <button className="btn primary" disabled={running || !text.trim()} onClick={() => send(text)}>
          Send
        </button>
      </section>
    </div>
  )
}
