import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { z } from 'zod'
import '../testServer.js'
import { AiError, askAi } from './ai.js'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answers every AI request with this, and keeps the last request body. */
function provider(status: number, answer: unknown) {
  const sent: { url?: string; body?: Record<string, unknown> } = {}
  globalThis.fetch = async (url, init) => {
    sent.url = String(url)
    sent.body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify(answer), { status })
  }
  return sent
}

const choice = (content: string, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }] })
const Shape = z.object({ names: z.array(z.string()) })
const ask = () => askAi({ system: 'Be brief.', prompt: 'Name two fruits.', schema: Shape })

test('the AI is asked for structured output in the JSON schema of the shape, and its answer is parsed', async () => {
  const sent = provider(200, choice('{"names": ["apple", "pear"]}'))
  assert.deepEqual(await ask(), { names: ['apple', 'pear'] })
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  assert.equal(sent.body?.model, 'gemini-3.8-flash')
  assert.deepEqual(sent.body?.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Name two fruits.' },
  ])
  const format = sent.body?.response_format as { type: string; json_schema: { schema: Record<string, unknown> } }
  assert.equal(format.type, 'json_schema')
  assert.equal(format.json_schema.schema.type, 'object')
  assert.equal('$schema' in format.json_schema.schema, false)
})

test('an answer that is cut off, not JSON, the wrong shape or refused is an AiError', async () => {
  for (const [status, answer] of [
    [200, choice('{"names": ["app', 'length')],
    [200, choice('Sure! Here are two fruits.')],
    [200, choice('{"fruits": 2}')],
    [400, { error: { message: 'Invalid schema' } }],
  ] as const) {
    provider(status, answer)
    await assert.rejects(ask(), AiError)
  }
})
