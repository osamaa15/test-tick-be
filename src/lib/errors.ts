import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

/** An error the caller caused. Its status and message are sent as they are, so the message is written for people. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { message: 'Not found.' } })
}

/** Every error ends here, as `{ error: { message, issues? } }`. A 500 never shows its details to the caller. */
export const handleErrors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    res.status(400).json({ error: { message: 'The request is not valid.', issues } })
    return
  }
  // `expose` marks Express's own client errors, such as a body that is not JSON or is too large.
  const status: number = err instanceof HttpError || err?.expose ? err.status : 500
  if (status >= 500) req.log.error({ err }, 'request failed')
  res.status(status).json({ error: { message: status >= 500 ? 'Something went wrong on our side.' : err.message } })
}
