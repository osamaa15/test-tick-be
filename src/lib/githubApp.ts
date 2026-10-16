import { createPrivateKey, createSign } from 'node:crypto'
import { z } from 'zod'
import { config } from '../config.js'
import { GitHubError, gitHubFetch, gitHubGet } from './github.js'

// Testick's GitHub App acting as itself, not as a person: it reads code during syncs and regenerating.

const privateKey = createPrivateKey(Buffer.from(config.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf8'))

/** The app proves who it is with a JWT signed by its private key. GitHub takes one for at most 10 minutes. */
export function appJwt(now = Math.floor(Date.now() / 1000)) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  // Issued a minute early, in case GitHub's clock is behind ours.
  const claims = { iat: now - 60, exp: now + 540, iss: String(config.GITHUB_APP_ID) }
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}`
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`
}

const Installation = z.object({ id: z.number() })
const AccessToken = z.object({ token: z.string(), expires_at: z.string() })

// An installation token lasts an hour; each is reused until 5 minutes before it runs out.
const tokens = new Map<string, { token: string; expiresAt: number }>()

/**
 * A token that can only read this one repository's contents. A 404 (GitHubError) means the app is not
 * installed on it any more.
 */
export async function installationToken(owner: string, repo: string, repoId: string): Promise<string> {
  const cached = tokens.get(repoId)
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token
  const jwt = appJwt()
  const { id } = Installation.parse(await gitHubGet(`/repos/${owner}/${repo}/installation`, jwt))
  const res = await gitHubFetch(`/app/installations/${id}/access_tokens`, jwt, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repository_ids: [Number(repoId)], permissions: { contents: 'read' } }),
  })
  const { token, expires_at } = AccessToken.parse(await res.json())
  tokens.set(repoId, { token, expiresAt: Date.parse(expires_at) })
  return token
}

const filePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** These files at a commit, as text. One that is not there any more is left out. */
export async function readFiles(token: string, owner: string, repo: string, ref: string, paths: string[]) {
  const read = async (path: string): Promise<[string, string][]> => {
    try {
      const res = await gitHubFetch(`/repos/${owner}/${repo}/contents/${filePath(path)}?ref=${ref}`, token, {
        headers: { accept: 'application/vnd.github.raw+json' },
      })
      return [[path, await res.text()]]
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return []
      throw err
    }
  }
  return (await Promise.all(paths.map(read))).flat()
}
