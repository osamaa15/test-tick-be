import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'

// config.ts reads these on import, so they are set before the app loads. Nothing here reaches the database.
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY = 'test'

const { createApp } = await import('./app.js')
const server = createApp().listen(0)
await once(server, 'listening')
const base = `http://localhost:${(server.address() as AddressInfo).port}`
after(() => server.close())

const postContact = (body: string) =>
  fetch(`${base}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })

test('health answers ok with security headers', async () => {
  const res = await fetch(`${base}/health`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'ok' })
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-powered-by'), null)
})

test('an unknown route is a JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: { message: 'Not found.' } })
})

test('a body that is not JSON is a 400, not a 500', async () => {
  const res = await postContact('{oops')
  assert.equal(res.status, 400)
})

test('contact refuses a wrong message and says which fields', async () => {
  const res = await postContact(JSON.stringify({ name: ' ', email: 'nope', topic: 'spam', message: 'short' }))
  assert.equal(res.status, 400)
  const { error } = (await res.json()) as { error: { issues: { path: string }[] } }
  assert.deepEqual(error.issues.map((issue) => issue.path).sort(), ['email', 'message', 'name', 'topic'])
})

test('contact is rate limited per caller', async () => {
  const statuses = []
  for (let i = 0; i < 6; i++) statuses.push((await postContact('{}')).status)
  assert.equal(statuses.at(-1), 429)
})

test('docs list the contact endpoint', async () => {
  const res = await fetch(`${base}/api/openapi.json`)
  const document = (await res.json()) as { paths: Record<string, unknown> }
  assert.ok(document.paths['/api/contact'])
  assert.equal((await fetch(`${base}/api/docs/`)).status, 200)
})
