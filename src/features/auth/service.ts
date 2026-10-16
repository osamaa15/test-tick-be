import { supabase } from '../../lib/supabase.js'
import { exchangeCode, getGitHubUser } from './github.js'
import type { Role, Session } from './schemas.js'
import { toSession } from './session.js'
import { saveTokens } from './tokens.js'

/**
 * Signs a person in with the code GitHub sent back. Their profile is refreshed (their role is kept) and
 * their tokens are stored sealed, for reading repositories later. Returns their user id.
 */
export async function signInWithGitHub(code: string): Promise<string> {
  const tokens = await exchangeCode(code)
  const profile = await getGitHubUser(tokens.access_token)

  const { data: user, error } = await supabase
    .from('users')
    .upsert(
      {
        provider: 'github',
        provider_user_id: String(profile.id),
        name: profile.name || profile.login,
        username: profile.login,
        avatar_url: profile.avatar_url,
      },
      { onConflict: 'provider,provider_user_id' },
    )
    .select('id')
    .single()
  if (error) throw error

  await saveTokens(user.id, tokens)
  return user.id
}

/** Saves the person's own role, and returns their session with it. */
export async function setRole(userId: string, role: Role): Promise<Session> {
  const { data, error } = await supabase.from('users').update({ role }).eq('id', userId).select().single()
  if (error) throw error
  return toSession(data)
}
