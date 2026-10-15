import { z } from 'zod'
import { config } from '../../config.js'

// The two GitHub calls sign-in needs. Repository calls join them in step 4.

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

/** Trades the code GitHub sent back for the person's tokens. A code works once, for 10 minutes. */
export async function exchangeCode(code: string) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json()) as { error?: string }
  // A wrong or used code is a 200 with `error` in the body.
  if (!res.ok || body.error) throw new Error(`GitHub refused the code: ${body.error ?? res.status}`)
  return Tokens.parse(body)
}

const GitHubUser = z.object({ id: z.number(), login: z.string(), name: z.string().nullable(), avatar_url: z.string() })

/** The signed-in person's profile. */
export async function getGitHubUser(accessToken: string) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Testick',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GitHub /user answered ${res.status}`)
  return GitHubUser.parse(await res.json())
}
