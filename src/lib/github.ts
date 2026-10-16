/** GitHub said no. `status` is its HTTP status, and `code` its OAuth error (such as `bad_refresh_token`) when there is one. */
export class GitHubError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** One GET from GitHub's REST API with a person's access token. Answers the parsed JSON. */
export async function gitHubGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Testick',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new GitHubError(`GitHub ${path.split('?')[0]} answered ${res.status}`, res.status)
  return res.json()
}
