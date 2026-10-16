import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import '../../testServer.js'
import { emailTeam } from './service.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const message = { name: 'Sam\nLee', email: 'sam@example.com', topic: 'bug' as const, message: 'The cart forgets my items.' }

test('a contact message is emailed to the team inbox, and replying answers the visitor', async () => {
  let sent: { url: string; auth: string | null; body: Record<string, unknown> } | undefined
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) }
    return new Response(JSON.stringify({ id: 'email-1' }))
  }
  await emailTeam(message)
  assert.equal(sent?.url, 'https://api.resend.com/emails')
  assert.equal(sent?.auth, 'Bearer test')
  assert.deepEqual(sent?.body, {
    from: 'Testick <onboarding@resend.dev>',
    to: ['team@example.com'],
    reply_to: 'sam@example.com',
    // A line break in the name never reaches the subject line.
    subject: 'Testick bug: Sam Lee',
    text: 'The cart forgets my items.\n\n--\nSam\nLee <sam@example.com>\nTopic: bug',
  })
})

test('a refused email is an error the caller can log', async () => {
  globalThis.fetch = async () => new Response('{"message":"Invalid API key"}', { status: 401 })
  await assert.rejects(emailTeam(message), /Resend answered 401/)
})
