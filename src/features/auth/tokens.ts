import { seal, unseal } from '../../lib/crypto.js'
import { HttpError } from '../../lib/errors.js'
import { GitHubError } from '../../lib/github.js'
import { supabase } from '../../lib/supabase.js'
import { refreshTokens, type Tokens } from './github.js'

const expiresAt = (seconds: number | undefined) =>
  seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString()

// A minute early, so a token does not run out on its way to GitHub.
const isFresh = (expires: string | null) => expires === null || Date.parse(expires) > Date.now() + 60_000

/** Stores the person's GitHub tokens, sealed. */
export async function saveTokens(userId: string, tokens: Tokens) {
  const { error } = await supabase.from('provider_tokens').upsert({
    user_id: userId,
    access_token: seal(tokens.access_token),
    access_token_expires_at: expiresAt(tokens.expires_in),
    refresh_token: tokens.refresh_token ? seal(tokens.refresh_token) : null,
    refresh_token_expires_at: expiresAt(tokens.refresh_token_expires_in),
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

/** What makes the person sign in again: nothing stored, or nothing GitHub will still take. */
const signInEnded = () => new GitHubError('No usable GitHub sign-in is stored', 401)

// A token sealed with an earlier TOKEN_ENCRYPTION_KEY cannot be opened, so the person signs in again.
function open(sealed: string) {
  try {
    return unseal(sealed)
  } catch {
    throw signInEnded()
  }
}

async function readTokens(userId: string) {
  const { data, error } = await supabase.from('provider_tokens').select().eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

async function refresh(userId: string, sealedRefreshToken: string): Promise<string> {
  try {
    const tokens = await refreshTokens(open(sealedRefreshToken))
    await saveTokens(userId, tokens)
    return tokens.access_token
  } catch (err) {
    // Another server may have just used this refresh token and stored the next ones: use those.
    if (err instanceof GitHubError && err.code === 'bad_refresh_token') {
      const latest = await readTokens(userId)
      if (latest && latest.refresh_token !== sealedRefreshToken && isFresh(latest.access_token_expires_at)) {
        return open(latest.access_token)
      }
    }
    throw err
  }
}

// GitHub takes each refresh token once, so this process renews one person's token one request at a time.
const refreshing = new Map<string, Promise<string>>()

async function accessToken(userId: string): Promise<string> {
  const tokens = await readTokens(userId)
  if (!tokens) throw signInEnded()
  if (isFresh(tokens.access_token_expires_at)) return open(tokens.access_token)
  if (!tokens.refresh_token) throw signInEnded()
  let pending = refreshing.get(userId)
  if (!pending) {
    pending = refresh(userId, tokens.refresh_token).finally(() => refreshing.delete(userId))
    refreshing.set(userId, pending)
  }
  return pending
}

/**
 * Calls GitHub as the person: `call` gets their access token, renewed first when it has run out (every 8 hours).
 * When GitHub no longer takes their sign-in (they revoked it, or the refresh token ran out after 6 months), every
 * session of theirs ends and this throws a 401, so the frontend sends them to sign in again.
 */
export async function asGitHubUser<T>(userId: string, call: (token: string) => Promise<T>): Promise<T> {
  try {
    return await call(await accessToken(userId))
  } catch (err) {
    if (!(err instanceof GitHubError && (err.status === 401 || err.code === 'bad_refresh_token'))) throw err
    const { error } = await supabase.from('sessions').delete().eq('user_id', userId)
    if (error) throw error
    throw new HttpError(401, 'Your GitHub sign-in has ended. Sign in again.')
  }
}
