import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { demoFileUrl, getRoom, getStory, meshUrl } from '../api'
import type { Room, ScanStory as Story } from '../types'
import { ErrorCard } from './Home'

const ModelSpin = lazy(() => import('../scene/ModelSpin'))

const cm = (m: number) => Math.round(m * 100)

/** "How this room was made": the phone video, each reconstruction stage, and how files moved between machines. */
export default function ScanStory() {
  const { id = '' } = useParams()
  const [story, setStory] = useState<Story | null | undefined>(undefined)
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [piece, setPiece] = useState(0)

  useEffect(() => {
    getStory(id).then(setStory, (e: Error) => setError(e.message))
    getRoom(id).then(setRoom, (e: Error) => setError(e.message))
  }, [id])

  const file = (name: string) => demoFileUrl(id, name)
  const roomLink = `/rooms/${encodeURIComponent(id)}`

  if (error) return <Shell><ErrorCard message={error} /></Shell>
  if (story === undefined || !room) return <div className="center-note muted">Loading…</div>
  if (story === null) {
    return (
      <Shell>
        <p className="muted">This room wasn't made from a scan, so there's no reconstruction to show.</p>
        <Link className="text-link" to={roomLink}>Back to the room</Link>
      </Shell>
    )
  }

  const p = story.pipeline
  const current = story.pieces[piece]
  const obj = room.objects.find((o) => o.name === current?.name)

  return (
    <Shell>
      <header className="story-hero">
        <p className="story-kicker">How this room was made</p>
        <h1>{room.name}: from a {Math.round(story.video.seconds)}-second phone video to a 3D room</h1>
        <p className="muted">
          A slow walk around a lounge, filmed on a phone. A GPU server worked out where the camera was, how far away
          everything was and which pixels were furniture, then built a 3D model of each piece. Back on the laptop the pieces
          were put in one room, tested with physics, cleaned up and loaded into otto.
        </p>
        <div className="story-hero-grid">
          <video className="story-video" src={file('walkthrough.mp4')} poster={file('poster.jpg')} controls muted playsInline preload="metadata" />
          <div className="story-stats">
            <Stat value={`${story.video.seconds} s`} label={`phone video, ${story.video.frames} frames`} />
            <Stat value={String(story.candidates)} label="furniture candidates found" />
            <Stat value={String(story.kept)} label="pieces in the final room" />
            <Stat value={`~${p.minutes.depth + p.minutes.tracking + p.minutes.models} min`} label={`on one ${p.gpu}`} />
            <Link className="btn primary" to={roomLink}>Open the room in 3D</Link>
            <p className="story-note">People who happened to be in the video are blurred.</p>
          </div>
        </div>
      </header>

      <section className="story-section">
        <h2>The route the data took</h2>
        <ol className="story-route">
          <RouteStep where="Phone" what="Records the walk-through" size={`${p.sizes_mb.phone_video} MB .mov`} />
          <RouteStep where="MacBook" what="Turns it upright and into a standard video, then uploads it" size={`${p.sizes_mb.uploaded} MB .mp4`} />
          <RouteStep where="Lab GPU server" what="Camera path and depth, furniture tracking, a 3D model per piece" size={`${p.sizes_mb.results} MB of results`} />
          <RouteStep where="MacBook" what="Builds one room, runs the physics test, cleans up, shrinks the files" size={`${p.sizes_mb.room} MB room`} />
          <RouteStep where="otto" what="The room you can open, edit and shop for" size="this website" />
        </ol>
      </section>

      <Stage n={1} title="Where was the camera, and how far is everything?" tool="ViPE" minutes={p.minutes.depth}>
        <p>
          For every frame, ViPE estimates the phone's position and angle and a depth map in real metres. Warm colours are close,
          cool colours far away. Together they turn the flat video into points in 3D space.
        </p>
        <div className="story-frames">
          {story.stage_frames.map((f, i) => (
            <figure key={f.frame}>
              <div className="story-pair">
                <img src={file(`frame${i}.jpg`)} alt={`Video frame at ${f.time} s`} loading="lazy" />
                <img src={file(`depth${i}.jpg`)} alt={`Depth map at ${f.time} s`} loading="lazy" />
              </div>
              <figcaption>{f.time} s: photo and depth</figcaption>
            </figure>
          ))}
        </div>
      </Stage>

      <Stage n={2} title="Which pixels are furniture?" tool="SAM 3.1" minutes={p.minutes.tracking}>
        <p>
          SAM 3.1 is given words like “sofa”, “armchair”, “table” and “lamp”. It finds every match and follows each one through the
          video, even pieces that only come into view later. It tracked {story.tracked_frames} frames and found {story.candidates}{' '}
          candidates. Bright colours are pieces that made it into the final room; grey ones were dropped later.
        </p>
        <div className="story-frames">
          {story.stage_frames.map((f, i) => (
            <figure key={f.frame}>
              <img src={file(`masks${i}.jpg`)} alt={`Furniture masks at ${f.time} s`} loading="lazy" />
              <figcaption>
                {f.time} s: {f.objects} {f.objects === 1 ? 'piece' : 'pieces'} ({f.labels.join(', ')})
              </figcaption>
            </figure>
          ))}
        </div>
      </Stage>

      <Stage n={3} title="A 3D model of each piece" tool="SAM 3D Objects" minutes={p.minutes.models}>
        <p>
          For each candidate, SAM 3D Objects takes one good view and the depth behind it and builds a full 3D mesh, including the
          sides the camera never saw. Pick a piece to see what it was built from and the model it became.
        </p>
        <div className="story-pieces">
          {story.pieces.map((pc, i) => (
            <button key={pc.name} className={`story-piece${i === piece ? ' on' : ''}`} onClick={() => setPiece(i)}>
              <img src={file(`input_${pc.name}.jpg`)} alt={`What the ${pc.label} model was built from`} loading="lazy" />
              <span>{pc.label}</span>
            </button>
          ))}
        </div>
        {current && (
          <div className="story-piece-detail">
            <img src={file(`input_${current.name}.jpg`)} alt={`Input view of the ${current.label}`} />
            <Suspense fallback={<div className="model-spin muted">Loading model…</div>}>
              {obj?.mesh && <ModelSpin url={meshUrl(id, obj.mesh)} label={current.label} />}
            </Suspense>
            <dl className="story-facts">
              <dt>Piece</dt>
              <dd>{current.label}</dd>
              <dt>Size</dt>
              <dd>{current.size.map(cm).join(' × ')} cm</dd>
              <dt>Built from</dt>
              <dd>frame {current.frame}</dd>
              <dt>Match to the scan</dt>
              <dd>{current.rmse_cm} cm average error</dd>
            </dl>
          </div>
        )}
      </Stage>

      <Stage n={4} title="Putting the pieces in one room">
        <p>
          The depth points are joined into one cloud of {story.points.toLocaleString()} points and turned so the floor is flat.
          The first try picked the chair seats as the floor, because the phone was pointed down at about 45°, so the furniture came out
          flat. Working out “down” from how the phone was held, rather than where it pointed, fixed it.
        </p>
        <figure className="story-wide">
          <img src={file('floor.png')} alt="Side view of the scan before and after the floor fix" loading="lazy" />
          <figcaption>Side view of the scan. Coloured points are the final pieces; the black line is where the floor was detected.</figcaption>
        </figure>
        <figure className="story-wide">
          <img src={file('topdown.png')} alt="Floor plan with the phone's path and the final pieces" loading="lazy" />
          <figcaption>From above: the scan (grey), the path the phone took (red) and the final pieces.</figcaption>
        </figure>
      </Stage>

      <Stage n={5} title="Testing it with physics, then cleaning up">
        <p>
          The room was loaded into the MuJoCo physics engine and run for a few seconds. Real furniture should just sit there. With all{' '}
          {story.candidates} candidates, duplicates (the same chair found as “chair”, “armchair” and “table”) sat inside each other and
          were flung across the room. Keeping only pieces whose 3D model matched the scan ({story.fitted} of {story.candidates}) and
          merging duplicates left {story.kept}, and they don't move at all.
        </p>
        <div className="story-frames story-two">
          <figure>
            <img src={file('physics_before.jpg')} alt="All candidates after one second of physics" loading="lazy" />
            <figcaption>All {story.candidates} candidates after 1 s of physics</figcaption>
          </figure>
          <figure>
            <img src={file('physics_after.jpg')} alt="The cleaned room after one second of physics" loading="lazy" />
            <figcaption>The {story.kept} kept pieces after 1 s: nothing moved</figcaption>
          </figure>
        </div>
      </Stage>

      <Stage n={6} title="Into otto">
        <p>
          The models came off the server with up to a million triangles each. They were simplified to 40,000 (shape changed by under
          1 mm) and the points thinned and cropped to the room, taking {p.sizes_mb.results} MB down to {p.sizes_mb.room} MB. Now it's
          a normal otto room: drag the pieces, check what fits from the shop, or switch on “Scan points” to see the raw scan.
        </p>
        <Link className="btn primary" to={roomLink}>Open the room in 3D</Link>
      </Stage>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="home">
      <header className="topbar">
        <Link to="/" className="wordmark">otto</Link>
      </header>
      <main className="story-main">{children}</main>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="story-stat">
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  )
}

function RouteStep({ where, what, size }: { where: string; what: string; size: string }) {
  return (
    <li className="card story-route-step">
      <strong>{where}</strong>
      <span>{what}</span>
      <span className="muted">{size}</span>
    </li>
  )
}

function Stage({ n, title, tool, minutes, children }: { n: number; title: string; tool?: string; minutes?: number; children: React.ReactNode }) {
  return (
    <section className="story-section">
      <p className="story-kicker">
        Step {n}
        {tool && ` · ${tool}`}
        {minutes != null && ` · about ${minutes} min on the GPU`}
      </p>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
