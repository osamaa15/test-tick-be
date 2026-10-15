import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'
import type { Database } from './database.types.js'

// The server decides who may see what itself, so it uses the secret key, which skips row level security.
// It keeps no session: this client always acts as the server, never as a signed-in person.
export const supabase = createClient<Database>(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  // A database call that hangs fails after 10 seconds instead of holding the request open.
  global: {
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) }),
  },
})
