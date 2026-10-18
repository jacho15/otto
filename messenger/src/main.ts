// otto on Photon: text a furniture photo, get the closest pieces back, see one in your room.
//
// Always runs Photon's terminal chat (no account needed). With a Photon 2.0 project ID and project API key
// in otto's .env it also answers on iMessage.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Spectrum, attachment } from 'spectrum-ts'
import { terminal } from 'spectrum-ts/providers/terminal'
import { newState, parseChoice, respond, type Incoming, type State } from './conversation'
import { ottoApi } from './ottoApi'
import { runPhotonV2, type Outbox } from './photonV2'

const envFile = resolve(import.meta.dirname, '../../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

// The first of these names that is set wins.
const env = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v)
const OTTO_API = env('OTTO_API_URL') ?? 'http://localhost:8000'
const PUBLIC_URL = env('OTTO_PUBLIC_URL') ?? 'http://localhost:5173'
const ROOM = env('OTTO_ROOM') ?? 'demo-living-room'
const projectId = env('PHOTON_PROJECT_ID', 'Photon_Project_ID')
const projectKey = env('PHOTON_API_KEY', 'Photon_FULL_API_KEY', 'Photon_Demo_API_KEY')
// OTTO_TERMINAL=off skips the terminal chat window, so iMessage logs print plainly.
const withTerminal = env('OTTO_TERMINAL') !== 'off'
const lookbackSeconds = Number(env('OTTO_LOOKBACK_SECONDS') ?? 5)

const otto = ottoApi(OTTO_API)
const states = new Map<string, State>()
const queues = new Map<string, Promise<void>>()

async function handle(key: string, outbox: Outbox, msg: Incoming) {
  const state = states.get(key) ?? newState(ROOM)
  const slow = msg.kind === 'photo' || parseChoice(msg.text, state.matches.length) !== null
  // The slow steps get a heads-up and typing dots, so the chat doesn't look stuck.
  if (msg.kind === 'photo') await outbox.text('Looking at your photo…')
  else if (slow) await outbox.text('Putting it in your room. This takes about half a minute…')
  if (slow) await outbox.typing(true)
  try {
    const turn = await respond(otto, state, msg, PUBLIC_URL)
    states.set(key, turn.state)
    for (const r of turn.replies) {
      if ('text' in r) await outbox.text(r.text)
      else await outbox.image(r.image, r.mimeType, r.name)
    }
  } finally {
    if (slow) await outbox.typing(false)
  }
}

/** One conversation at a time per chat, but chats don't wait for each other. */
function enqueue(key: string, outbox: Outbox, msg: Incoming) {
  const next = (queues.get(key) ?? Promise.resolve())
    .then(() => handle(key, outbox, msg))
    .catch((e) => console.error(`[${key}] reply failed:`, e instanceof Error ? e.message : e, (e as { body?: unknown })?.body ?? ''))
  queues.set(key, next)
}

if (projectId && projectKey) {
  void runPhotonV2({ key: projectKey, project: projectId, lookbackSeconds }, enqueue)
} else {
  console.log('No Photon keys in .env, so iMessage is off. The terminal chat still works.')
}

const app = withTerminal ? await Spectrum({ providers: [terminal.config()] }) : null
if (app) console.log('otto is listening on the terminal')
if (app) for await (const [space, message] of app.messages) {
  if (message.direction !== 'inbound') continue
  const content = message.content
  let msg: Incoming | null = null
  if (content.type === 'text') msg = { kind: 'text', text: content.text }
  else if (content.type === 'attachment') msg = { kind: 'photo', read: () => content.read(), mimeType: content.mimeType }
  if (!msg) continue
  const outbox: Outbox = {
    text: async (text) => void (await space.send(text)),
    image: async (image, mimeType, name) => void (await space.send(attachment(image, { mimeType, name }))),
    typing: async () => undefined,
  }
  enqueue(`terminal:${space.id}`, outbox, msg)
}
