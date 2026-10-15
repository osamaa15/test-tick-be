import type { Request, Response } from 'express'
import { config } from '../../config.js'
import { randomToken, sha256 } from '../../lib/crypto.js'
import type { Database } from '../../lib/database.types.js'
import { HttpError } from '../../lib/errors.js'
import { supabase } from '../../lib/supabase.js'
import { Provider, Role, type Session } from './schemas.js'

export const SESSION_COOKIE = 'testick_session'
const SESSION_DAYS = 30

/**
 * httpOnly: page scripts cannot read it. sameSite lax: other sites' forms and fetches do not send it.
 * Secure in production. The frontend and API must share a site for the browser to send it (see .env.example).
 */
export const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const

type UserRow = Database['public']['Tables']['users']['Row']

export const toSession = (row: UserRow): Session => ({
  user: {
    id: row.id,
    name: row.name,
    username: row.username,
    avatarUrl: row.avatar_url,
    role: Role.nullable().parse(row.role),
  },
  provider: Provider.parse(row.provider),
})

/** Signs a browser in: a random token in the cookie, only its hash in the database. */
export async function startSession(res: Response, userId: string) {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  const { error } = await supabase
    .from('sessions')
    .insert({ token_hash: sha256(token), user_id: userId, expires_at: expires.toISOString() })
  if (error) throw error
  // Their expired sessions go now, so the table only grows with real sign-ins.
  await supabase.from('sessions').delete().eq('user_id', userId).lt('expires_at', new Date().toISOString())
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires })
}

/**
 * The session of the browser asking, or null.
 * shortcut: a session lasts 30 days from sign-in and is not extended by use; slide `expires_at` here if people complain.
 */
export async function currentSession(req: Request): Promise<Session | null> {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token !== 'string') return null
  const { data, error } = await supabase
    .from('sessions')
    .select('user:users(*)')
    .eq('token_hash', sha256(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) throw error
  return data?.user ? toSession(data.user) : null
}

/** The session, or a 401. Every route behind sign-in starts with this. */
export async function requireSession(req: Request): Promise<Session> {
  const session = await currentSession(req)
  if (!session) throw new HttpError(401, 'Sign in to continue.')
  return session
}

/** Signs this browser out. Fine to call when it is not signed in. */
export async function endSession(req: Request, res: Response) {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token === 'string') {
    const { error } = await supabase.from('sessions').delete().eq('token_hash', sha256(token))
    if (error) throw error
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions)
}
