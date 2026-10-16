import { z } from 'zod'
import { config } from '../../config.js'
import { GitHubError, gitHubGet } from '../../lib/github.js'

// Signing in with GitHub, and renewing the person's tokens.

export const callbackUrl = `${config.API_URL}/api/auth/github/callback`

/** Where to send the browser to sign in. GitHub sends it back to `callbackUrl` with a code and this state. */
export function authorizeUrl(state: string) {
  const params = new URLSearchParams({ client_id: config.GITHUB_CLIENT_ID, redirect_uri: callbackUrl, state })
  return `https://github.com/login/oauth/authorize?${params}`
}

const Tokens = z.object({
  access_token: z.string(),
  // Seconds. Missing when the GitHub App does not expire user tokens.
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
})
export type Tokens = z.infer<typeof Tokens>

/** Asks GitHub for the person's tokens, with a sign-in code or a refresh token. */
async function requestTokens(grant: Record<string, string>) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.GITHUB_CLIENT_ID, client_secret: config.GITHUB_CLIENT_SECRET, ...grant }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json()) as { error?: string }
  // A wrong or used code or refresh token is a 200 with `error` in the body.
  if (!res.ok || body.error) throw new GitHubError(`GitHub refused: ${body.error ?? res.status}`, res.status, body.error)
  return Tokens.parse(body)
}

/** Trades the code GitHub sent back for the person's tokens. A code works once, for 10 minutes. */
export const exchangeCode = (code: string) => requestTokens({ code, redirect_uri: callbackUrl })

/** New tokens for an expired access token. A refresh token works once: the answer carries the next one. */
export const refreshTokens = (refreshToken: string) =>
  requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken })

const GitHubUser = z.object({ id: z.number(), login: z.string(), name: z.string().nullable(), avatar_url: z.string() })

/** The signed-in person's profile. */
export async function getGitHubUser(accessToken: string) {
  return GitHubUser.parse(await gitHubGet('/user', accessToken))
}
