// Sets otto's name and picture on the Photon line, as people see them in iMessage.
// Run: npm run profile
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApiError, Photon } from '@photon-ai/api'

const FIRST_NAME = 'Otto'
const LAST_NAME = 'Your personal interior agent'
const AVATAR = resolve(import.meta.dirname, '../assets/otto-avatar.png')

const envFile = resolve(import.meta.dirname, '../../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const env = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v)
const projectId = env('PHOTON_PROJECT_ID', 'Photon_Project_ID')
const key = env('PHOTON_API_KEY', 'Photon_FULL_API_KEY')
if (!projectId || !key) throw new Error('Add Photon_Project_ID and Photon_FULL_API_KEY to .env')

const photon = new Photon({ headers: { Authorization: `Bearer ${key}` } })
const path = { projectId }
const run = Date.now().toString(36)

try {
  const named = await photon.projects.agentProfile.update({
    path,
    headers: { idempotencyKey: `otto-profile-name-${run}` },
    body: { firstName: FIRST_NAME, lastName: LAST_NAME },
  })
  console.log(`Name: ${named.firstName} ${named.lastName ?? ''}`.trim())

  // Photon's presigned upload: copy every form field, the file goes last, and no Photon credentials go to the bucket.
  const upload = await photon.projects.agentProfile.createAvatarUpload({ path, body: { contentType: 'image/png' } })
  const form = new FormData()
  for (const [k, v] of Object.entries(upload.formFields)) form.append(k, String(v))
  form.append('file', new Blob([new Uint8Array(readFileSync(AVATAR))], { type: 'image/png' }), 'otto-avatar.png')
  const res = await fetch(upload.uploadUrl, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`The picture upload failed (${res.status}).`)

  const done = await photon.projects.agentProfile.commitAvatar({
    path,
    headers: { idempotencyKey: `otto-profile-avatar-${upload.uploadId}` },
    body: { uploadId: upload.uploadId },
  })
  console.log(`Picture: ${done.avatarUrl ? 'set' : 'not set'}`)
} catch (e) {
  if (e instanceof ApiError) console.error(`Photon API error ${e.status}: ${e.message}`)
  else console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
}
