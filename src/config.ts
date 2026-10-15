import { z } from 'zod'

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.url().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
})

// Fail at startup, not on the first request that needs a missing value. What each one means is in .env.example.
const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  console.error('The environment is not valid. Compare .env with .env.example.\n' + z.prettifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
