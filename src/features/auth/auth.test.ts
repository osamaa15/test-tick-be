import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestServer } from '../../testServer.js'

const base = await startTestServer()

test('nobody signed in: the session is null', async () => {
  const res = await fetch(`${base}/api/session`)
  assert.equal(res.status, 200)
  assert.equal(await res.json(), null)
})

test('saving a role needs a session', async () => {
  const res = await fetch(`${base}/api/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'tester' }),
  })
  assert.equal(res.status, 401)
})

test('disconnecting and deleting an account need a session', async () => {
  assert.equal((await fetch(`${base}/api/auth/disconnect`, { method: 'POST' })).status, 401)
  assert.equal((await fetch(`${base}/api/me`, { method: 'DELETE' })).status, 401)
})

test('signing out with no session is fine', async () => {
  const res = await fetch(`${base}/api/auth/sign-out`, { method: 'POST' })
  assert.equal(res.status, 204)
  assert.match(res.headers.get('set-cookie') ?? '', /testick_session=;/)
})

test('sign-in sends the browser to GitHub with a state it also keeps in a cookie', async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: 'manual' })
  assert.equal(res.status, 302)
  const to = new URL(res.headers.get('location') ?? '')
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(to.searchParams.get('client_id'), 'test-client-id')
  assert.equal(to.searchParams.get('redirect_uri'), 'http://localhost:4000/api/auth/github/callback')
  const cookie = res.headers.get('set-cookie') ?? ''
  assert.ok(cookie.startsWith(`testick_oauth_state=${to.searchParams.get('state')};`))
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
})

test('a callback whose state does not match its cookie signs nobody in', async () => {
  for (const cookie of ['testick_oauth_state=expected', '']) {
    const res = await fetch(`${base}/api/auth/github/callback?code=abc&state=forged`, {
      redirect: 'manual',
      headers: { cookie },
    })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), 'http://localhost:5173/auth/callback?error=sign-in-failed')
    assert.doesNotMatch(res.headers.getSetCookie().join(), /testick_session=[^;]/)
  }
})
