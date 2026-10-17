import assert from 'node:assert/strict'
import { createHmac, createPublicKey, createVerify } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { create } from 'tar'
import { startTestServer } from '../../testServer.js'
import { config } from '../../config.js'
import { sha256 } from '../../lib/crypto.js'
import { appJwt } from '../../lib/githubApp.js'
import { isCodeFile, readArchive } from './code.js'
import { planFeatures } from './plan.js'

const base = await startTestServer()

test('the sync history and Sync now need a session', async () => {
  const path = `${base}/api/projects/7f9c1d2e-0000-4000-8000-000000000000/syncs`
  assert.equal((await fetch(path)).status, 401)
  assert.equal((await fetch(path, { method: 'POST' })).status, 401)
})

const deliver = (event: string, payload: object, signature?: string) => {
  const body = JSON.stringify(payload)
  const signed = `sha256=${createHmac('sha256', config.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`
  return fetch(`${base}/api/webhooks/github`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': signature ?? signed },
    body,
  })
}

test('a webhook without the right signature is refused', async () => {
  assert.equal((await deliver('ping', { zen: 'hi' }, '')).status, 401)
  assert.equal((await deliver('ping', { zen: 'hi' }, `sha256=${'0'.repeat(64)}`)).status, 401)
})

test('a signed webhook is accepted; a tag or a deleted branch starts nothing', async () => {
  assert.equal((await deliver('ping', { zen: 'hi' })).status, 202)
  // The test database is not reachable, so reaching it would answer 500.
  assert.equal((await deliver('push', { ref: 'refs/tags/v1', repository: { id: 1 } })).status, 202)
  assert.equal((await deliver('push', { ref: 'refs/heads/main', deleted: true, repository: { id: 1 } })).status, 202)
})

test('only source and docs are read, never dependencies, builds, media or big files', () => {
  assert.equal(isCodeFile('src/routes/login.ts', 2_000), true)
  assert.equal(isCodeFile('README.md', 500), true)
  for (const path of ['node_modules/x/index.js', 'web/dist/app.js', 'logo.PNG', 'package-lock.json', 'a/yarn.lock', 'app.min.js']) {
    assert.equal(isCodeFile(path, 100), false, path)
  }
  assert.equal(isCodeFile('src/huge.ts', 100_001), false)
  assert.equal(isCodeFile('src/empty.ts', 0), false)
})

test('an archive becomes its code files by path, without its top folder or binary files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'testick-archive-'))
  try {
    const files: Record<string, string> = {
      'acme-shop-abc123/src/login.ts': 'export const login = 1',
      'acme-shop-abc123/docs/guide.md': '# Guide',
      'acme-shop-abc123/node_modules/left-pad/index.js': 'module.exports = 1',
      'acme-shop-abc123/data.bin': 'a\0b',
      'acme-shop-abc123/big.ts': 'x'.repeat(100_001),
    }
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    const read = await readArchive(create({ gzip: true, cwd: dir }, ['acme-shop-abc123']))
    assert.deepEqual(Object.fromEntries(read), { 'src/login.ts': 'export const login = 1', 'docs/guide.md': '# Guide' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a feature is added when its name is new, changed when the code of its old files changed, untouched otherwise', () => {
  const files = new Map([
    ['src/login.ts', 'login v2'],
    ['src/cart.ts', 'cart'],
    ['src/checkout.ts', 'checkout v2'],
  ])
  const hashOf = (path: string, text: string) => sha256(`${path}\0${text}`)
  const known = [
    { id: 'f1', name: 'Sign in', description: 'old', paths: ['src/login.ts'], code_hash: hashOf('src/login.ts', 'login v2') },
    { id: 'f2', name: 'Checkout', description: 'old', paths: ['src/checkout.ts'], code_hash: hashOf('src/checkout.ts', 'v1') },
  ]
  const found = [
    // Listed with another file this time, but its own file did not change.
    { name: 'sign in', description: 'Signs people in.', paths: ['src/login.ts', 'src/gone.ts', 'src/cart.ts'] },
    { name: 'Checkout', description: 'Takes payment.', paths: ['src/checkout.ts'] },
    { name: 'Cart', description: 'Holds items.', paths: ['src/cart.ts'] },
    { name: 'cart', description: 'Twice.', paths: [] },
    { name: '  ', description: 'No name.', paths: [] },
  ]
  const planned = planFeatures(known, found, files)
  assert.deepEqual(
    planned.map((feature) => [feature.id, feature.name, feature.change, feature.paths]),
    [
      ['f1', 'Sign in', null, ['src/cart.ts', 'src/login.ts']],
      ['f2', 'Checkout', 'changed', ['src/checkout.ts']],
      [null, 'Cart', 'added', ['src/cart.ts']],
    ],
  )
  assert.equal(planned[0]?.description, 'Signs people in.')
})

test("the app's JWT is signed with its private key and lasts under 10 minutes", () => {
  const now = 1_800_000_000
  const [header, payload, signature] = appJwt(now).split('.') as [string, string, string]
  const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' })
  assert.deepEqual(decode(payload), { iat: now - 60, exp: now + 540, iss: '1' })
  const key = createPublicKey(Buffer.from(config.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf8'))
  assert.equal(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(key, signature, 'base64url'), true)
})
