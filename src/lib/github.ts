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

/** One request to GitHub's REST API with a token: a person's, the app's JWT or an installation's. */
export async function gitHubFetch(
  path: string,
  token: string,
  { headers, ...init }: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
) {
  const res = await fetch(`https://api.github.com${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Testick',
      ...headers,
    },
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw new GitHubError(`GitHub ${path.split('?')[0]} answered ${res.status}`, res.status)
  }
  return res
}

/** One GET from GitHub's REST API. Answers the parsed JSON. */
export async function gitHubGet(path: string, token: string): Promise<unknown> {
  return (await gitHubFetch(path, token)).json()
}
