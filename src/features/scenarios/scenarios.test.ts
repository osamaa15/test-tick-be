import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestServer } from '../../testServer.js'
import { NewScenario, ScenarioInput } from './schemas.js'
import { cleanInput, toScenario } from './service.js'

const base = await startTestServer()
const id = '7f9c1d2e-0000-4000-8000-000000000000'

test('every scenarios route needs a session, before the body is read', async () => {
  const json = (method: string) => ({ method, headers: { 'content-type': 'application/json' }, body: '{}' })
  const calls = [
    fetch(`${base}/api/projects/${id}/features/${id}`),
    fetch(`${base}/api/scenarios/${id}/result`, json('PUT')),
    fetch(`${base}/api/features/${id}/scenarios`, json('POST')),
    fetch(`${base}/api/scenarios/${id}`, json('PATCH')),
    fetch(`${base}/api/features/${id}/regenerate`, json('POST')),
  ]
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401)
})

test('docs list the scenarios routes', async () => {
  const { paths } = (await (await fetch(`${base}/api/openapi.json`)).json()) as { paths: Record<string, object> }
  assert.ok('get' in (paths['/api/projects/{projectId}/features/{featureId}'] ?? {}))
  assert.ok('put' in (paths['/api/scenarios/{scenarioId}/result'] ?? {}))
  assert.ok('post' in (paths['/api/features/{featureId}/scenarios'] ?? {}))
  assert.ok('patch' in (paths['/api/scenarios/{scenarioId}'] ?? {}))
})

test('a scenario is trimmed, loses empty steps and blank preconditions', () => {
  const input = ScenarioInput.parse({
    kind: 'negative',
    title: '  Sign in with a wrong password ',
    preconditions: '   ',
    steps: [' Open sign in ', '', '  ', 'Type a wrong password'],
    expected: ' An error says the password is wrong. ',
  })
  assert.deepEqual(cleanInput(input), {
    kind: 'negative',
    title: 'Sign in with a wrong password',
    preconditions: null,
    steps: ['Open sign in', 'Type a wrong password'],
    expected: 'An error says the password is wrong.',
  })
})

test('a scenario without a title or an expected result is refused, naming the fields', () => {
  const result = NewScenario.safeParse({ role: 'tester', kind: 'edge-case', title: ' ', preconditions: null, steps: [], expected: '' })
  assert.equal(result.success, false)
  assert.deepEqual(result.error?.issues.map((issue) => issue.path.join('.')).sort(), ['expected', 'title'])
  assert.equal(NewScenario.safeParse({ role: 'lead', kind: 'smoke', title: 'x', preconditions: null, steps: [], expected: 'y' }).success, false)
})

test('a result shows who marked it, and is null while nobody has', () => {
  const row = {
    id,
    seq: 1,
    feature_id: id,
    role: 'tester',
    kind: 'happy-path',
    title: 't',
    preconditions: null,
    steps: [],
    expected: 'e',
    origin: 'ai',
    verdict: null,
    marked_by: null,
    marked_at: null,
    created_at: '2026-10-16T10:00:00Z',
    marker: null,
  }
  assert.equal(toScenario(row).result, null)
  const marked = { ...row, verdict: 'failed', marked_by: id, marked_at: '2026-10-16T11:00:00Z', marker: { id, name: 'Sam' } }
  assert.deepEqual(toScenario(marked).result, { verdict: 'failed', markedBy: { id, name: 'Sam' }, markedAt: '2026-10-16T11:00:00Z' })
  assert.equal(toScenario({ ...marked, marked_by: null, marker: null }).result?.markedBy.name, 'A former teammate')
})
