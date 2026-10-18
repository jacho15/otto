import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { STEPS, TOTAL_MS, itemAt, tickerLine, timelineAt, type DemoFacts, type StepKey } from '../demoTimeline'
import type { DemoPiece } from '../scene/DemoRoom'

const ModelSpin = lazy(() => import('../scene/ModelSpin'))
const DemoRoom = lazy(() => import('../scene/DemoRoom'))

const BASE = '/demo/lounge'
const FILE_NAME = 'lounge-walkthrough.mp4'
const SAMPLE_TYPE = 'application/x-otto-sample'
const MOMENTS = 4 // stage pictures per step: frame0..3, depth0..3, masks0..3

interface Story {
  video: { seconds: number; frames: number }
  candidates: number
  kept: number
  pieces: { name: string; label: string; size: [number, number, number] }[]
  pipeline: { minutes: { depth: number; tracking: number; models: number }; sizes_mb: { uploaded: number } }
}

type Phase = 'idle' | 'running' | 'done'

/**
 * A replay of a real reconstruction: drop the sample walk-through in the box and watch it become a room.
 * Nothing is uploaded; the pictures and models are the real outputs of that video.
 */
export default function ScanDemo() {
  const [story, setStory] = useState<Story | null>(null)
  const [pieces, setPieces] = useState<DemoPiece[]>([])
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [over, setOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const startRef = useRef(0)

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/story.json`).then((r) => r.json() as Promise<Story>),
      fetch(`${BASE}/room.json`).then((r) => r.json() as Promise<{ objects: DemoPiece[] }>),
    ]).then(
      ([s, room]) => {
        setStory(s)
        setPieces(room.objects)
      },
      () => setError('The demo files did not load. Reload the page to try again.'),
    )
  }, [])

  // Drive the replay clock.
  useEffect(() => {
    if (phase !== 'running') return
    let raf = 0
    const tick = (now: number) => {
      const t = now - startRef.current
      setElapsed(t)
      if (t >= TOTAL_MS) setPhase('done')
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  const start = useCallback(() => {
    import('@react-three/drei').then(({ useGLTF }) => {
      for (const p of pieces) useGLTF.preload(`${BASE}/${p.mesh}`)
    })
    setNotice(null)
    setElapsed(0)
    startRef.current = performance.now()
    setPhase('running')
  }, [pieces])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (e.dataTransfer.types.includes(SAMPLE_TYPE)) start()
    else if (e.dataTransfer.files.length) setNotice('This demo replays the sample walk-through. Drag the sample clip into the box to see it.')
  }

  if (error) return <Frame><p className="demo-notice">{error}</p></Frame>
  if (!story) return <Frame><p className="demo-loading">Loading the demo…</p></Frame>

  const facts: DemoFacts = {
    fileName: FILE_NAME,
    uploadMb: story.pipeline.sizes_mb.uploaded,
    frames: story.video.frames,
    candidates: story.candidates,
    kept: story.kept,
    pieces: story.pieces.map((p) => p.label),
  }
  const gpuMinutes = story.pipeline.minutes.depth + story.pipeline.minutes.tracking + story.pipeline.minutes.models

  if (phase === 'idle') {
    return (
      <Frame>
        <section className="demo-intro">
          <h1>See a phone video become a room.</h1>
          <p className="demo-lede">Walk slowly around a room with your phone. Otto measures it, finds the furniture and rebuilds every piece in 3D.</p>
        </section>
        <div className="demo-start">
          <div
            className={`demo-drop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <DropIcon />
            <p className="demo-drop-title">Drop a room video here</p>
            <p className="demo-drop-hint">.mp4 or .mov, up to a minute</p>
          </div>
          <aside className="demo-sample">
            <p className="demo-sample-ask">No video handy? Try this one.</p>
            <div
              className="demo-clip"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(SAMPLE_TYPE, 'lounge')
                e.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <video src={`${BASE}/walkthrough.mp4`} poster={`${BASE}/poster.jpg`} muted loop playsInline autoPlay preload="metadata" />
              <div className="demo-clip-info">
                <strong>{FILE_NAME}</strong>
                <span>{Math.round(story.video.seconds)} s walk-through of a lounge</span>
              </div>
            </div>
            <p className="demo-sample-how">Drag it into the box, or</p>
            <button className="btn primary" onClick={start}>Use this video</button>
          </aside>
        </div>
        {notice && <p className="demo-notice" role="status">{notice}</p>}
        <p className="demo-foot">The faces of people who were in the room are blurred.</p>
      </Frame>
    )
  }

  const m = timelineAt(elapsed)
  const step = STEPS[Math.min(m.index, STEPS.length - 1)]

  if (phase === 'done') {
    return (
      <Frame>
        <section className="demo-done">
          <Ring overall={1} done />
          <div className="demo-done-copy">
            <h1>Your room is ready.</h1>
            <p className="demo-lede">
              {story.kept} pieces, rebuilt at their real size from a {Math.round(story.video.seconds)}-second video. Drag the room to look around.
            </p>
            <div className="demo-actions">
              <button className="btn" onClick={start}>Replay</button>
              <Link className="btn primary" to="/">Plan your own room</Link>
            </div>
          </div>
        </section>
        <div className="demo-room">
          <Suspense fallback={<p className="demo-loading">Loading the room…</p>}>
            <DemoRoom base={BASE} pieces={pieces} />
          </Suspense>
        </div>
        <ul className="demo-piece-list">
          {story.pieces.map((p) => (
            <li key={p.name}>
              <img src={`${BASE}/input_${p.name}.jpg`} alt="" />
              <span>{p.label}</span>
              <span className="demo-dim">{p.size.map((v) => Math.round(v * 100)).join(' × ')} cm</span>
            </li>
          ))}
        </ul>
        <p className="demo-foot">A sped-up replay of a real reconstruction of this video. The real run took about {gpuMinutes} minutes on a GPU server.</p>
      </Frame>
    )
  }

  return (
    <Frame>
      <section className="demo-run" aria-live="polite">
        <Ring overall={m.overall} label={`${m.index + 1}`} />
        <div className="demo-run-copy">
          <p className="demo-step-count">Step {m.index + 1} of {STEPS.length}</p>
          <h1 key={step.key} className="demo-step-title">{step.title}</h1>
          <p className="demo-lede">{step.blurb}</p>
          <p className="demo-ticker">{tickerLine(step.key, m.stepProgress, facts)}</p>
        </div>
        <button className="demo-skip" onClick={() => setPhase('done')}>Skip to the room</button>
      </section>
      <div className="demo-stage">
        <StageVisual stepKey={step.key} p={m.stepProgress} story={story} />
      </div>
      <ol className="demo-rail">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < m.index ? 'done' : i === m.index ? 'now' : ''}>
            <span className="demo-rail-bar">
              <span style={{ width: `${i < m.index ? 100 : i === m.index ? m.stepProgress * 100 : 0}%` }} />
            </span>
            {s.title}
          </li>
        ))}
      </ol>
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="demo-page">
      <header className="demo-top">
        <Link to="/" className="wordmark">otto</Link>
      </header>
      <main className="demo-main">{children}</main>
    </div>
  )
}

/** The progress ring: fills across the whole replay, shows the step number, and turns into a check at the end. */
function Ring({ overall, label, done }: { overall: number; label?: string; done?: boolean }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <div className={`demo-ring${done ? ' done' : ''}`}>
      <svg className="demo-ring-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="demo-ring-track" cx="60" cy="60" r={r} />
        <circle className="demo-ring-fill" cx="60" cy="60" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - overall)} />
        {!done && <circle className="demo-ring-spin" cx="60" cy="60" r={r} strokeDasharray={`10 ${c - 10}`} />}
      </svg>
      {done ? (
        <svg className="demo-check" viewBox="0 0 48 48" aria-label="Done">
          <path d="M13 25 l7 7 l15 -16" />
        </svg>
      ) : (
        <span className="demo-ring-label">
          <strong>{label}</strong>
          <span>of {STEPS.length}</span>
        </span>
      )}
    </div>
  )
}

/** What the server is looking at during each step, using the real outputs of the sample video. */
function StageVisual({ stepKey, p, story }: { stepKey: StepKey; p: number; story: Story }) {
  if (stepKey === 'upload') {
    return (
      <figure className="demo-visual demo-upload">
        <video src={`${BASE}/walkthrough.mp4`} poster={`${BASE}/poster.jpg`} muted autoPlay playsInline />
        <figcaption>
          <span className="demo-bar"><span style={{ width: `${p * 100}%` }} /></span>
          {FILE_NAME}
        </figcaption>
      </figure>
    )
  }
  if (stepKey === 'measure' || stepKey === 'find') {
    // Each moment sweeps from the photo to the step's result (depth or furniture masks).
    const i = itemAt(p, MOMENTS)
    const local = Math.min(1, (p * MOMENTS - i) * 1.4)
    const top = stepKey === 'measure' ? `depth${i}.jpg` : `masks${i}.jpg`
    return (
      <figure className="demo-visual demo-sweep" key={`${stepKey}${i}`}>
        <div className="demo-sweep-frame">
          <img src={`${BASE}/frame${i}.jpg`} alt="A frame from the video" />
          <img className="demo-sweep-top" src={`${BASE}/${top}`} alt={stepKey === 'measure' ? 'Its depth map' : 'The furniture found in it'} style={{ clipPath: `inset(0 0 ${100 - local * 100}% 0)` }} />
          <span className="demo-sweep-line" style={{ top: `${local * 100}%` }} />
        </div>
        <figcaption>{stepKey === 'measure' ? 'Warm is near, cool is far.' : 'Kept pieces in colour, false finds in grey.'}</figcaption>
      </figure>
    )
  }
  if (stepKey === 'build') {
    const i = itemAt(p, story.pieces.length)
    const piece = story.pieces[i]
    return (
      <figure className="demo-visual demo-build">
        <img key={piece.name} className="demo-build-input" src={`${BASE}/input_${piece.name}.jpg`} alt={`What the ${piece.label} was built from`} />
        <span className="demo-arrow" aria-hidden="true" />
        <Suspense fallback={<div className="model-spin" />}>
          <ModelSpin url={`${BASE}/meshes/${piece.name}.glb`} label={piece.label} />
        </Suspense>
        <figcaption>
          {piece.label}, {piece.size.map((v) => Math.round(v * 100)).join(' × ')} cm
        </figcaption>
      </figure>
    )
  }
  // assemble: the floor plan, then physics before and after the clean-up
  const pic = p < 0.4 ? 'topdown.png' : p < 0.7 ? 'physics_before.jpg' : 'physics_after.jpg'
  const caption =
    p < 0.4 ? 'From above: the scan, the path your phone took, and the pieces.' : p < 0.7 ? 'Duplicates overlap and get thrown around.' : 'Cleaned up: nothing moves.'
  return (
    <figure className="demo-visual demo-assemble" key={pic}>
      <img src={`${BASE}/${pic}`} alt={caption} />
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function DropIcon() {
  return (
    <svg className="demo-drop-icon" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="14" width="44" height="36" rx="6" />
      <path d="M32 22 v18 M24 32 l8 8 l8 -8" />
    </svg>
  )
}
