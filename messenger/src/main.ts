// otto on Photon: text a furniture photo, get the closest pieces back, see one in your room.
//
// Without Photon keys it runs on the terminal provider (a local chat window, no account needed).
// With SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in otto's .env it also answers on iMessage.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Spectrum, attachment } from 'spectrum-ts'
import { imessage } from 'spectrum-ts/providers/imessage'
import { terminal } from 'spectrum-ts/providers/terminal'
import { newState, parseChoice, respond, type Incoming, type Reply, type State } from './conversation'
import { ottoApi } from './ottoApi'

const envFile = resolve(import.meta.dirname, '../../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const OTTO_API = process.env.OTTO_API_URL ?? 'http://localhost:8000'
const PUBLIC_URL = process.env.OTTO_PUBLIC_URL ?? 'http://localhost:5173'
const ROOM = process.env.OTTO_ROOM ?? 'demo-living-room'
const projectId = process.env.SPECTRUM_PROJECT_ID ?? process.env.PHOTON_PROJECT_ID
const projectSecret = process.env.SPECTRUM_PROJECT_SECRET ?? process.env.PHOTON_PROJECT_SECRET
const live = Boolean(projectId && projectSecret)

const app = live
  ? await Spectrum({ projectId: projectId!, projectSecret: projectSecret!, providers: [imessage.config(), terminal.config()] })
  : await Spectrum({ providers: [terminal.config()] })
console.log(`otto is listening on ${live ? 'iMessage and the terminal' : 'the terminal (add Photon keys to .env for iMessage)'}`)

const otto = ottoApi(OTTO_API)
const states = new Map<string, State>()
const queues = new Map<string, Promise<void>>()

type Space = { send: (content: Parameters<typeof attachment>[0] | string | ReturnType<typeof attachment>) => Promise<unknown> }

async function send(space: Space, replies: Reply[]) {
  for (const r of replies) {
    if ('text' in r) await space.send(r.text)
    else await space.send(attachment(r.image, { mimeType: r.mimeType, name: r.name }))
  }
}

async function handle(key: string, space: Space, msg: Incoming) {
  const state = states.get(key) ?? newState(ROOM)
  // The slow steps get a heads-up first, so the chat doesn't look stuck.
  if (msg.kind === 'photo') await space.send('Looking at your photo…')
  else if (parseChoice(msg.text, state.matches.length)) await space.send('Putting it in your room. This takes about half a minute…')
  const turn = await respond(otto, state, msg, PUBLIC_URL)
  states.set(key, turn.state)
  await send(space, turn.replies)
}

for await (const [space, message] of app.messages) {
  if (message.direction !== 'inbound') continue
  const content = message.content
  let msg: Incoming | null = null
  if (content.type === 'text') msg = { kind: 'text', text: content.text }
  else if (content.type === 'attachment') msg = { kind: 'photo', read: () => content.read(), mimeType: content.mimeType }
  if (!msg) continue
  // One conversation at a time per chat, but chats don't wait for each other.
  const key = `${message.platform}:${space.id}`
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev
    .then(() => handle(key, space as unknown as Space, msg))
    .catch((e) => console.error(`[${key}]`, e))
  queues.set(key, next)
}
