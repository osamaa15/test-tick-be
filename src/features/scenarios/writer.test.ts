import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import '../../testServer.js'
import { writeScenarios } from './writer.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const scenario = (role: string, title: string, extra: object = {}) => ({
  role,
  kind: 'happy-path',
  title,
  preconditions: null,
  steps: [],
  expected: 'It works.',
  ...extra,
})

test('one request writes several features, and each scenario lands on its own feature', async () => {
  let prompt = ''
  globalThis.fetch = async (_url, init) => {
    prompt = JSON.parse(String(init?.body)).messages[1].content
    const answer = {
      features: [
        { feature: 2, scenarios: [scenario('tester', 'Add an item'), scenario('developer', 'Quantity over 99')] },
        {
          feature: 1,
          scenarios: [
            scenario('tester', '  Sign in  ', { preconditions: '  ', steps: [' Open sign in ', ''] }),
            scenario('tester', ' '),
            scenario('developer', 'Wrong password'),
          ],
        },
        { feature: 7, scenarios: [scenario('tester', 'No such feature')] },
      ],
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }))
  }

  const written = await writeScenarios(
    [
      { name: 'Sign in', description: 'Signs people in.', files: [['src/login.ts', 'login()']] },
      { name: 'Cart', description: 'Holds items.', files: [], existing: ['Remove an item'] },
    ],
    ['tester'],
  )
  assert.deepEqual(written, [
    [{ role: 'tester', kind: 'happy-path', title: 'Sign in', preconditions: null, steps: ['Open sign in'], expected: 'It works.' }],
    [{ role: 'tester', kind: 'happy-path', title: 'Add an item', preconditions: null, steps: [], expected: 'It works.' }],
  ])
  for (const part of ['## Feature 1: Sign in', '<file path="src/login.ts">', '## Feature 2: Cart', '- Remove an item', 'for: tester']) {
    assert.ok(prompt.includes(part), part)
  }
})
