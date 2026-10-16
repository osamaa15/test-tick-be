import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { HttpError } from '../../lib/errors.js'
import { errorResponses, registry, sessionCookie } from '../../lib/openapi.js'
import { requireSession } from '../auth/session.js'
import { ProjectParams, SyncHistory } from './schemas.js'
import { getSyncHistory, requestSync } from './service.js'
import { wakeSyncWorker } from './worker.js'

export const syncsRouter = Router()

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}/syncs',
  tags: ['syncs'],
  summary: "A project's sync history",
  description:
    'Every sync, newest first. The current sync (the newest that finished) has live counts; older ones keep their counts as they stood when the next sync finished. Running and failed syncs have no features.',
  security: [{ [sessionCookie.name]: [] }],
  request: { params: ProjectParams },
  responses: {
    200: { description: 'The history.', content: { 'application/json': { schema: SyncHistory } } },
    ...errorResponses(400, 401, 404, 429),
  },
})

syncsRouter.get('/projects/:projectId/syncs', async (req, res) => {
  const { user } = await requireSession(req)
  res.json(await getSyncHistory(user.id, ProjectParams.parse(req.params).projectId))
})

/** Mounted before the JSON parser: the signature is checked over the body exactly as GitHub sent it. */
export const webhooksRouter = Router()

/** Whether GitHub signed this body with the webhook secret (X-Hub-Signature-256). */
export function isSignedByGitHub(body: Buffer, signature: string | undefined) {
  const expected = Buffer.from(`sha256=${createHmac('sha256', config.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`)
  const given = Buffer.from(signature ?? '')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const Push = z.object({
  ref: z.string(),
  deleted: z.boolean().optional(),
  repository: z.object({ id: z.number(), default_branch: z.string() }),
})

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/github',
  tags: ['syncs'],
  summary: 'Events from the GitHub App',
  description:
    'Only GitHub calls it, signed with the webhook secret. A push to the default branch of a connected repository starts a sync, or one more after the sync that is running. Every other event is accepted and ignored.',
  request: {
    headers: z.object({ 'x-github-event': z.string(), 'x-hub-signature-256': z.string() }),
    body: { required: true, content: { 'application/json': { schema: z.object({}).passthrough() } } },
  },
  responses: {
    202: { description: 'Accepted.' },
    401: { description: 'The signature is missing or does not match.' },
    ...errorResponses(429),
  },
})

webhooksRouter.post('/github', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !isSignedByGitHub(req.body, req.get('x-hub-signature-256'))) {
    throw new HttpError(401, 'The signature does not match.')
  }
  if (req.get('x-github-event') === 'push') {
    const push = Push.parse(JSON.parse(req.body.toString('utf8')))
    // Only the default branch is synced, and a deleted branch has nothing to read.
    if (!push.deleted && push.ref === `refs/heads/${push.repository.default_branch}`) {
      if (await requestSync(String(push.repository.id), push.repository.default_branch)) wakeSyncWorker()
    }
  }
  res.status(202).end()
})
