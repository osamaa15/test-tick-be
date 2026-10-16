import { rateLimit } from 'express-rate-limit'

/**
 * Lets each caller (by IP address) make `limit` requests per `minutes`, then answers 429.
 * shortcut: counts live in this process's memory, so each instance limits on its own; pass a shared
 * store (rate-limit-redis) when more than one instance runs. People behind one office address share a
 * limit; key signed-in requests by person when teams start seeing 429s.
 */
export function limitRequests(limit: number, minutes: number) {
  return rateLimit({
    windowMs: minutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many requests. Try again later.' } },
  })
}
