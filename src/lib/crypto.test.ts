import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../testServer.js'

const { seal, unseal } = await import('./crypto.js')

test('a sealed secret opens to itself and does not show it', () => {
  const sealed = seal('gho_secret')
  assert.equal(unseal(sealed), 'gho_secret')
  assert.ok(!sealed.includes('gho_secret'))
  assert.notEqual(seal('gho_secret'), sealed, 'a fresh IV each time')
})

test('a sealed secret that was changed does not open', () => {
  const [iv, tag, data] = seal('gho_secret').split('.')
  const flipped = (data ?? '').startsWith('A') ? `B${data?.slice(1)}` : `A${data?.slice(1)}`
  assert.throws(() => unseal([iv, tag, flipped].join('.')))
  assert.throws(() => unseal('not sealed'))
})
