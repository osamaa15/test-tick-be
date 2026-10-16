import { generateKeyPairSync } from 'node:crypto'
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
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: Buffer.from(
    generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64'),
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
  AI_API_KEY: 'test',
  RESEND_API_KEY: 'test',
  CONTACT_INBOX: 'team@example.com',
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
