import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestServer } from '../../testServer.js'
import { toRepository } from './repositories.js'

const base = await startTestServer()

test('every projects route needs a session', async () => {
  const projectId = '7f9c1d2e-0000-4000-8000-000000000000'
  const calls = [
    fetch(`${base}/api/projects`),
    fetch(`${base}/api/projects/${projectId}`),
    fetch(`${base}/api/projects/${projectId}`, { method: 'DELETE' }),
    fetch(`${base}/api/repositories`),
    // A stranger gets 401 before their body is even read.
    fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  ]
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401)
})

test('docs list the projects routes', async () => {
  const { paths } = (await (await fetch(`${base}/api/openapi.json`)).json()) as { paths: Record<string, object> }
  for (const path of ['/api/projects', '/api/projects/{projectId}', '/api/repositories']) assert.ok(paths[path], path)
  assert.ok('post' in (paths['/api/projects'] ?? {}))
  assert.ok('delete' in (paths['/api/projects/{projectId}'] ?? {}))
})

const repo = (overrides: object) => ({
  id: 42,
  name: 'shop',
  owner: { login: 'acme' },
  description: null,
  private: false,
  default_branch: 'main',
  pushed_at: '2026-10-01T10:00:00Z',
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
})

test('a Lead has admin or maintain access to the repository', () => {
  const lead = (permissions?: object) => toRepository(repo({ permissions })).isLead
  assert.equal(lead({ admin: true, maintain: true, push: true }), true)
  assert.equal(lead({ admin: false, maintain: true, push: true }), true)
  assert.equal(lead({ admin: false, maintain: false, push: true }), false)
  assert.equal(lead({ admin: false, push: false, pull: true }), false)
  assert.equal(lead(undefined), false)
})

test('a repository keeps the frontend shape: string id, private or public, a push date', () => {
  assert.deepEqual(toRepository(repo({ private: true, pushed_at: null })), {
    id: '42',
    provider: 'github',
    owner: 'acme',
    name: 'shop',
    description: null,
    visibility: 'private',
    defaultBranch: 'main',
    pushedAt: '2026-01-01T10:00:00Z',
    isLead: false,
  })
})
