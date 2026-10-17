import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { randomToken } from '../../lib/crypto.js'
import { errorResponses, registry, sessionCookie } from '../../lib/openapi.js'
import { limitRequests } from '../../lib/rateLimit.js'
import { authorizeUrl } from './github.js'
import { RoleInput, Session } from './schemas.js'
import { deleteAccount, disconnectProvider, setRole, signInWithGitHub } from './service.js'
import { cookieOptions, currentSession, endSession, requireSession, SESSION_COOKIE, startSession } from './session.js'

export const authRouter = Router()

// Proves the browser that comes back from GitHub is the one that left, so nobody can slip their own sign-in into someone else's browser.
const STATE_COOKIE = 'testick_oauth_state'
const stateCookieOptions = { ...cookieOptions, path: '/api/auth/github' }

// Each sign-in costs GitHub calls and database writes.
const signInLimit = limitRequests(20, 15)

/** The frontend page sign-in ends on. It reads the session with GET /api/session. */
const backToFrontend = (error?: 'sign-in-failed') =>
  `${config.FRONTEND_URL}/auth/callback` + (error ? `?error=${error}` : '')

registry.registerPath({
  method: 'get',
  path: '/api/auth/github',
  tags: ['auth'],
  summary: 'Sign in with GitHub',
  description:
    'Open it in the browser, not with fetch. It redirects to GitHub, which comes back to the callback, which sets the session cookie and sends the browser to the frontend at /auth/callback. Shares a limit of 20 requests per 15 minutes per caller with the callback.',
  responses: { 302: { description: 'To GitHub.' }, ...errorResponses(429) },
})

authRouter.get('/auth/github', signInLimit, (_req, res) => {
  const state = randomToken()
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions, maxAge: 10 * 60_000 })
  res.redirect(authorizeUrl(state))
})

registry.registerPath({
  method: 'get',
  path: '/api/auth/github/callback',
  tags: ['auth'],
  summary: 'Where GitHub sends the browser back',
  description:
    'Only GitHub calls it. Signs the person in, then redirects to the frontend at /auth/callback, with `?error=sign-in-failed` when it did not work (cancelled, expired or tampered with).',
  request: { query: z.object({ code: z.string(), state: z.string() }) },
  responses: { 302: { description: 'To the frontend.' }, ...errorResponses(429) },
})

authRouter.get('/auth/github/callback', signInLimit, async (req, res) => {
  const expected: unknown = req.cookies?.[STATE_COOKIE]
  res.clearCookie(STATE_COOKIE, stateCookieOptions)
  const { code, state } = req.query
  if (typeof code !== 'string' || typeof state !== 'string' || typeof expected !== 'string' || state !== expected) {
    res.redirect(backToFrontend('sign-in-failed'))
    return
  }
  try {
    await startSession(res, await signInWithGitHub(code))
    res.redirect(backToFrontend())
  } catch (err) {
    // The browser is mid-redirect, so it goes back to the frontend rather than seeing a JSON error.
    req.log.error({ err }, 'sign-in failed')
    res.redirect(backToFrontend('sign-in-failed'))
  }
})

registry.registerPath({
  method: 'get',
  path: '/api/session',
  tags: ['auth'],
  summary: 'Who is signed in',
  responses: {
    200: {
      description: 'The session, or `null` when nobody is signed in.',
      content: { 'application/json': { schema: Session.nullable() } },
    },
  },
})

authRouter.get('/session', async (req, res) => {
  const session = await currentSession(req)
  // A cookie for a session that ended is dropped, so the browser stops sending it.
  if (!session && req.cookies?.[SESSION_COOKIE]) res.clearCookie(SESSION_COOKIE, cookieOptions)
  res.json(session)
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/sign-out',
  tags: ['auth'],
  summary: 'Sign this browser out',
  description: 'Ends the session and clears its cookie. Answers 204 even when nobody was signed in.',
  responses: { 204: { description: 'Signed out.' } },
})

authRouter.post('/auth/sign-out', async (req, res) => {
  await endSession(req, res)
  res.status(204).end()
})

registry.registerPath({
  method: 'patch',
  path: '/api/me',
  tags: ['auth'],
  summary: "Save the person's own role",
  security: [{ [sessionCookie.name]: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: RoleInput } } } },
  responses: {
    200: { description: 'The session, with the new role.', content: { 'application/json': { schema: Session } } },
    ...errorResponses(400, 401),
  },
})

authRouter.patch('/me', async (req, res) => {
  const { user } = await requireSession(req)
  res.json(await setRole(user.id, RoleInput.parse(req.body).role))
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/disconnect',
  tags: ['auth'],
  summary: 'Disconnect the provider',
  description:
    "Takes back the person's authorization of Testick on GitHub, forgets their GitHub tokens and ends all their sessions, on every browser. Their Testick account stays: signing in again connects it again.",
  security: [{ [sessionCookie.name]: [] }],
  responses: { 204: { description: 'Disconnected and signed out.' }, ...errorResponses(401, 429) },
})

authRouter.post('/auth/disconnect', limitRequests(10, 15), async (req, res) => {
  const { user } = await requireSession(req)
  await disconnectProvider(user.id)
  res.clearCookie(SESSION_COOKIE, cookieOptions).status(204).end()
})

registry.registerPath({
  method: 'delete',
  path: '/api/me',
  tags: ['auth'],
  summary: "Delete the person's Testick account",
  description:
    'Disconnects GitHub as `/api/auth/disconnect` does, then deletes the account and what is only theirs (New or Changed marks). Results they marked stay for the team, shown as marked by a former teammate. Projects stay for everyone else with access.',
  security: [{ [sessionCookie.name]: [] }],
  responses: { 204: { description: 'Deleted and signed out.' }, ...errorResponses(401, 429) },
})

authRouter.delete('/me', limitRequests(10, 15), async (req, res) => {
  const { user } = await requireSession(req)
  await deleteAccount(user.id)
  res.clearCookie(SESSION_COOKIE, cookieOptions).status(204).end()
})
