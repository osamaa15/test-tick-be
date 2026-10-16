import { createPrivateKey } from 'node:crypto'
import { z } from 'zod'

const isPrivateKey = (base64: string) => {
  try {
    createPrivateKey(Buffer.from(base64, 'base64').toString('utf8'))
    return true
  } catch {
    return false
  }
}

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  API_URL: z.url().default('http://localhost:4000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .refine(isPrivateKey, "Must be the GitHub App's private key (.pem), base64-encoded on one line. See .env.example."),
  GITHUB_WEBHOOK_SECRET: z.string().min(20, 'Must be at least 20 random characters. See .env.example.'),
  AI_API_KEY: z.string().min(1),
  AI_BASE_URL: z.url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  // Several, comma-separated: the next is tried when one is busy.
  AI_MODEL: z.string().min(1).default('gemini-3.6-flash,gemini-3.8-flash,gemini-3-flash-preview'),
  RESEND_API_KEY: z.string().min(1),
  CONTACT_INBOX: z.email(),
  CONTACT_FROM: z.string().min(1).default('Testick <onboarding@resend.dev>'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((key) => Buffer.from(key, 'base64').length === 32, 'Must be 32 random bytes in base64. See .env.example.'),
})

// Fail at startup, not on the first request that needs a missing value. What each one means is in .env.example.
const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  console.error('The environment is not valid. Compare .env with .env.example.\n' + z.prettifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
