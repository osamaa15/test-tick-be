import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { after } from 'node:test'

// config.ts reads these when it is first imported, so a test file imports this module before anything
// from the app. Tests never reach the real database or GitHub.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SECRET_KEY: 'test',
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
})

/** Starts the whole app on a free port for one test file and stops it when the file ends. Returns its base URL. */
export async function startTestServer() {
  const { createApp } = await import('./app.js')
  const server = createApp().listen(0)
  await once(server, 'listening')
  after(() => server.close())
  return `http://localhost:${(server.address() as AddressInfo).port}`
}
