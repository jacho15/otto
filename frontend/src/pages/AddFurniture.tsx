import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createCustomItem, importLink, uploadFile } from '../api'
import { errorText } from '../checkoutLogic'
import {
  LABELS,
  checkFile,
  checkSize,
  convertText,
  fromMetres,
  parsePrice,
  rangeText,
  titleFromFile,
  type DropIntent,
  type FileKind,
  type SizeUnit,
} from '../furnitureLogic'
import { convertToGlb, modelFormat } from '../modelConvert'
import type { CustomItem, NewCustomItem, Vec3 } from '../types'

interface Props {
  /** A piece is being added to the room. */
  busy: boolean
  /** Something dropped on the 3D view. A new `id` starts it again. */
  intent: (DropIntent & { id: number }) | null
  /** The server made this item (it now belongs in the user's list). */
  onSaved: (item: CustomItem) => void
  onAdd: (catalogId: string) => void
}

type Mode = 'link' | 'photo' | 'model'

const MODE_TEXT: Record<Mode, string> = { link: 'Link', photo: 'Photo', model: '3D file' }
const ACCEPT: Record<FileKind, string> = {
  photo: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
  model: '.glb,.obj,.stl,.ply,model/gltf-binary',
}

interface Form {
  title: string
  price: string
  currency: string
  label: string
  size: [string, string, string]
  url: string
  imageUrl: string | null // a photo on the shop's own site, to preview and let the server fetch
  photo: string | null // an uploaded photo
  model: string | null // an uploaded .glb
  notes: string[]
}

const blankForm: Form = {
  title: '',
  price: '',
  currency: 'USD',
  label: '',
  size: ['', '', ''],
  url: '',
  imageUrl: null,
  photo: null,
  model: null,
  notes: [],
}

const sizeTexts = (size: Vec3 | null, unit: SizeUnit): [string, string, string] =>
  size ? [String(fromMetres(size[0], unit)), String(fromMetres(size[1], unit)), String(fromMetres(size[2], unit))] : ['', '', '']

/** Add a piece of furniture from a shop link, a photo or a 3D file, then place it or keep it for later. */
export default function AddFurniture({ busy, intent, onSaved, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('link')
  const [link, setLink] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [unit, setUnit] = useState<SizeUnit>('cm')
  const [working, setWorking] = useState<'reading' | 'uploading' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const latest = useRef(0) // a response that is no longer the latest request is ignored
  const handled = useRef(0)

  const start = (job: (isLatest: () => boolean) => Promise<void>, kind: 'reading' | 'uploading') => {
    const mine = ++latest.current
    setWorking(kind)
    setError(null)
    setSaved(null)
    setForm(null)
    job(() => mine === latest.current)
      .catch((e) => mine === latest.current && setError(errorText(e)))
      .finally(() => mine === latest.current && setWorking(null))
  }

  const read = (url: string) =>
    start(async (isLatest) => {
      const d = await importLink(url.trim())
      if (!isLatest()) return
      setUnit('cm')
      setForm({
        ...blankForm,
        title: d.title,
        price: d.price == null ? '' : String(d.price),
        currency: d.currency ?? 'USD',
        label: d.label,
        size: sizeTexts(d.size, 'cm'),
        url: d.url,
        imageUrl: d.image_url,
        notes: d.notes,
      })
    }, 'reading')

  const upload = (kind: FileKind, file: File) => {
    const problem = checkFile(kind, file)
    if (problem) {
      latest.current++
      setWorking(null)
      setForm(null)
      return setError(problem)
    }
    start(async (isLatest) => {
      // .obj, .stl and .ply become a .glb first. With no typed size, the size comes from the model.
      const converted = kind === 'model' && modelFormat(file.name) ? await convertToGlb(file) : null
      if (!isLatest()) return
      const r = await uploadFile(converted?.file ?? file)
      if (!isLatest()) return
      setUnit('cm')
      setForm({
        ...blankForm,
        title: titleFromFile(file.name),
        size: sizeTexts(converted?.size ?? null, 'cm'),
        notes: converted ? [converted.note] : [],
        photo: kind === 'photo' ? r.url : null,
        model: kind === 'model' ? r.url : null,
      })
    }, 'uploading')
  }

  useEffect(() => {
    if (!intent || handled.current === intent.id) return
    handled.current = intent.id
    setOpen(true)
    setMode(intent.kind)
    if (intent.kind === 'link') {
      setLink(intent.url)
      read(intent.url)
    } else {
      upload(intent.kind, intent.file)
    }
  }, [intent])

  const pickMode = (m: Mode) => {
    if (m === mode) return
    latest.current++
    setMode(m)
    setForm(null)
    setWorking(null)
    setError(null)
    setSaved(null)
  }

  const switchUnit = (u: SizeUnit) => {
    if (!form || u === unit) return
    setForm({ ...form, size: form.size.map((t) => convertText(t, unit, u)) as Form['size'] })
    setUnit(u)
    setError(null)
  }

  const set = (patch: Partial<Form>) => setForm((f) => f && { ...f, ...patch })

  // The item to send, or the message that says what to fix.
  const build = (f: Form): NewCustomItem | string => {
    if (!f.title.trim()) return 'Enter a title.'
    if (!f.label) return 'Choose a type.'
    const size = checkSize(f.size, unit)
    if ('error' in size) return size.error
    const price = parsePrice(f.price)
    if (price === undefined) return 'Price must be a number of 0 or more.'
    if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) return 'Currency must be a 3-letter code, like USD.'
    return {
      title: f.title.trim(),
      url: f.url || undefined,
      price,
      currency: f.currency.trim().toUpperCase(),
      size: size.size,
      label: f.label,
      photo: f.photo ?? undefined,
      model: f.model ?? undefined,
      image_url: f.imageUrl ?? undefined,
    }
  }

  const save = async (place: boolean) => {
    if (!form) return
    const item = build(form)
    if (typeof item === 'string') return setError(item)
    const mine = ++latest.current
    setWorking('saving')
    setError(null)
    try {
      const made = await createCustomItem(item)
      onSaved(made)
      if (place) onAdd(made.id)
      if (mine !== latest.current) return // something newer was dropped meanwhile; leave it alone
      if (!place) setSaved(`Saved ${made.title} to your items.`)
      setForm(null)
      setLink('')
    } catch (e) {
      if (mine === latest.current) setError(errorText(e))
    } finally {
      if (mine === latest.current) setWorking(null)
    }
  }

  const onRead = (e: FormEvent) => {
    e.preventDefault()
    if (link.trim()) read(link)
  }

  const photo = form?.photo?.startsWith('/api/') ? form.photo : null // never load a page's own image here
  const locked = working !== null

  return (
    <section className="card checkout-card">
      <button className="furniture-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="checkout-title">Add any furniture</span>
        <span className="muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <div className="tabs furniture-tabs" role="group" aria-label="Add from">
            {(Object.keys(MODE_TEXT) as Mode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => pickMode(m)}>
                {MODE_TEXT[m]}
              </button>
            ))}
          </div>
          {mode === 'link' ? (
            <form className="layouts-form" onSubmit={onRead}>
              <input
                className="checkout-text"
                value={link}
                disabled={locked}
                placeholder="Paste a link to a product page"
                onChange={(e) => setLink(e.target.value)}
              />
              <button className="btn" type="submit" disabled={locked || !link.trim()}>
                {working === 'reading' ? 'Reading…' : 'Read'}
              </button>
            </form>
          ) : (
            <label className="furniture-file">
              <span className="muted">{mode === 'photo' ? 'A photo (JPEG, PNG or WebP, up to 5 MB)' : 'A .glb, .obj, .stl or .ply model (up to 25 MB)'}</span>
              <input
                type="file"
                accept={ACCEPT[mode]}
                disabled={locked}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) upload(mode, file)
                }}
              />
            </label>
          )}
          {working === 'uploading' && <p className="muted">Uploading…</p>}
          {saved && <p className="muted">{saved}</p>}
          {error && <div className="save-error">{error}</div>}
          {form && (
            <div className="checkout-form furniture-form">
              {photo ? (
                <img className="shop-photo furniture-preview" src={photo} alt="" />
              ) : (
                form.imageUrl && (
                  <div
                    className="shop-photo placeholder furniture-preview"
                    style={{ fontSize: 14, fontWeight: 400, padding: 12, textAlign: 'center' }}
                  >
                    Photo will be saved with the item
                  </div>
                )
              )}
              <label>
                Title
                <input value={form.title} onChange={(e) => set({ title: e.target.value })} />
              </label>
              <div className="furniture-pair">
                <label>
                  Price (optional)
                  <input type="number" min="0" step="any" value={form.price} onChange={(e) => set({ price: e.target.value })} />
                </label>
                <label>
                  Currency
                  <input value={form.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value })} />
                </label>
              </div>
              <label>
                Type
                <select value={form.label} onChange={(e) => set({ label: e.target.value })}>
                  <option value="">Choose a type</option>
                  {[...new Set([...(form.label ? [form.label] : []), ...LABELS])].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <div className="unit-toggle" role="group" aria-label="Unit">
                <span className="muted">Unit</span>
                {(['cm', 'in'] as const).map((u) => (
                  <button key={u} type="button" className={unit === u ? 'on' : ''} onClick={() => switchUnit(u)}>
                    {u}
                  </button>
                ))}
              </div>
              <div className="new-place-row">
                {(['Width', 'Depth', 'Height'] as const).map((name, i) => (
                  <label key={name}>
                    {name} ({unit})
                    <input
                      type="number"
                      step="any"
                      placeholder={rangeText(name.toLowerCase() as 'width' | 'depth' | 'height', unit)}
                      value={form.size[i]}
                      onChange={(e) => set({ size: form.size.map((t, j) => (j === i ? e.target.value : t)) as Form['size'] })}
                    />
                  </label>
                ))}
              </div>
              {form.model && <p className="muted shop-size">The model is stretched to this size.</p>}
              {form.notes.map((n, i) => (
                <p key={i} className="muted shop-size">
                  {n}
                </p>
              ))}
              <div className="shop-actions">
                <button className="btn primary" disabled={locked || busy} onClick={() => save(true)}>
                  {working === 'saving' ? 'Saving…' : 'Add to room'}
                </button>
                <button className="btn" disabled={locked} onClick={() => save(false)}>
                  Save to my items
                </button>
                <button className="btn" disabled={locked} onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
