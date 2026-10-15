# Architecture

How a request moves through the backend, what keeps it safe, and what has to change when it runs at a larger scale.

## A request, in order

`createApp()` in `src/app.ts` sets up the middleware in this order. The order is deliberate.

| Step | What | Why here |
| --- | --- | --- |
| 1 | `trust proxy` = `TRUST_PROXY` | So `req.ip` is the caller, not the load balancer. The rate limiter keys on it. |
| 2 | `pino-http` | Logs every request (except `/health`) with an id, status and time. Cookie and authorization headers are redacted. |
| 3 | `helmet` | Security headers on every answer, errors included: no `X-Powered-By`, `nosniff`, a strict Content-Security-Policy, HSTS and more. |
| 4 | `cors` | Only `FRONTEND_URL` may call from a browser, with cookies (`credentials: true`). |
| 5 | `express.json({ limit: '100kb' })` | Parses JSON bodies. A bigger body is a 413, and broken JSON a 400, before any handler runs. |
| 5b | `cookie-parser` | Fills `req.cookies`, where the session and sign-in state cookies are read. |
| 6 | `GET /health` | Before the rate limit, so uptime checks are never refused. It never touches the database, so a database outage does not make the host restart a healthy server. |
| 7 | `/api` + `limitRequests(1000, 15)` | One limit for the whole API, per caller. Routes add stricter ones. |
| 8 | Feature routers | Each validates its input, calls its service, and answers. |
| 9 | Swagger, outside production | `/api/docs` (the page) and `/api/openapi.json` (the document, for Postman or generating code). |
| 10 | `notFound`, then `handleErrors` | Anything unmatched is a JSON 404. Every error ends in one format. |

## Errors

Every error answer has the same shape:

```json
{ "error": { "message": "The request is not valid.", "issues": [{ "path": "email", "message": "Write a valid email address." }] } }
```

| Thrown | Status | Message sent |
| --- | --- | --- |
| `ZodError` (from `Schema.parse`) | 400 | "The request is not valid." plus `issues`, one per wrong field |
| `HttpError(status, message)` | `status` | `message` as it is |
| Express's own client errors (bad JSON, body too large) | Their 4xx | Their message |
| Anything else | 500 | "Something went wrong on our side." The real error is logged with the request id. |

Express 5 sends a rejected promise from a handler to `handleErrors` by itself, so handlers are `async` and simply `throw`.

The frontend turns a 404 into `NotFoundError` and any other failure into `Error` (see the API contract).

## Security

- **Input**: every body, param and query is parsed with Zod at the handler. Strings are trimmed and have a maximum length. The database repeats the most important limits as `check` constraints.
- **Headers**: helmet's defaults. Swagger UI works with them because it loads its scripts as files.
- **CORS**: one allowed origin, `FRONTEND_URL`. No wildcard, because the API uses cookies.
- **Rate limits**: per IP address. `/api` allows 1000 requests per 15 minutes (the frontend polls every 3 seconds while a sync runs). `POST /api/contact` allows 5 an hour. Sign-in (`/api/auth/github` and its callback together) allows 20 per 15 minutes. Answers carry the `RateLimit` and `RateLimit-Policy` headers (IETF draft 8).
- **Secrets**: only in `.env` (git-ignored), read only by `config.ts`, which stops the server at startup when one is missing or wrong. Logs redact cookies and authorization headers.
- **Database**: the server uses the Supabase secret key and checks access itself. Row level security is on for every table with no policies, so the public `anon` key can read nothing. See `docs/database.md`.
- **Errors**: a 500 never sends its message or stack to the caller.
- **Swagger**: served only when `NODE_ENV` is not `production`.

### Sign-in and sessions

1. `GET /api/auth/github` makes a random state, keeps it in a 10-minute httpOnly cookie scoped to `/api/auth/github`, and redirects to GitHub.
2. GitHub sends the browser to `/api/auth/github/callback` with a code and the state. The state must equal the cookie, so nobody can push their own sign-in into someone else's browser.
3. The code is traded for the person's tokens, their profile is read, `users` is upserted (their role is kept), and the tokens are stored sealed in `provider_tokens`.
4. A new session: 32 random bytes in the `testick_session` cookie, only its SHA-256 in `sessions`, for 30 days. Then the browser goes to the frontend's `/auth/callback`, or `/auth/callback?error=sign-in-failed` when anything went wrong.

- **The cookie** is `httpOnly` (page scripts cannot read it), `SameSite=Lax` and `Secure` in production.
- **Cross-site requests**: `SameSite=Lax` means another site's form or fetch never carries the cookie, so it cannot change data as the person. Bodies are JSON only, which a plain HTML form cannot send.
- **Same site**: browsers send a Lax cookie only when `FRONTEND_URL` and `API_URL` share a site (`localhost` with any port, or `app.example.com` with `api.example.com`). Hosting them on unrelated domains breaks sign-in; put the API behind the frontend's domain instead.
- **Signing out** deletes the session row, so a stolen cookie stops working at once. Deleting a user deletes their sessions and tokens.
- **Routes behind sign-in** call `requireSession(req)`, which answers 401 without a valid session.

Not built yet: per-user rate limits (with step 4's routes), and revoking the GitHub token on disconnect (planned in Settings).

## Reliability

- **Fail fast**: wrong configuration stops the server at startup with a list of what is wrong.
- **Timeouts**: every Supabase call is aborted after 10 seconds. Node's own server timeouts stay at their defaults.
- **Graceful shutdown**: on `SIGTERM` or `SIGINT` the server stops taking connections, finishes the requests in flight, and exits. If that takes over 10 seconds it exits anyway.
- **Crashes**: an unhandled promise rejection stops the process (Node's default), and the host restarts it. That beats running on in an unknown state.
- **Logs**: one JSON object per line in production, so any log tool can search by request id, status or path. Readable lines in development (`pino-pretty`).
- **Source maps**: `npm start` runs with `--enable-source-maps`, so stack traces point at the TypeScript lines.

## Scaling

The app keeps no state in memory between requests apart from the rate-limit counts, so more instances can run behind a load balancer. Before that happens:

| Limit today | Change when |
| --- | --- |
| Rate-limit counts live in each process (`shortcut:` in `src/lib/rateLimit.ts`) | More than one instance runs: give `limitRequests` a shared store such as `rate-limit-redis`. |
| No job queue yet | Step 6: syncs and AI writing run in a worker from a queue, never inside a request. |
| No caching of provider calls yet | Step 4: cache what the provider answers about repositories and access for a short time, per user. |
| Compression is left to the host or proxy | The app is served without a proxy that compresses. |

## Adding to it

- A new endpoint: the `new-endpoint` skill.
- A new table: the `new-migration` skill.
- A new setting: add it to `Env` in `src/config.ts` and to `.env.example`, with a line saying what it is.
