# Architecture

How a request moves through the backend, what keeps it safe, and what has to change when it runs at a larger scale.

## A request, in order

`createApp()` in `src/app.ts` sets up the middleware in this order. The order is deliberate.

| Step | What | Why here |
| --- | --- | --- |
| 1 | `trust proxy` = `TRUST_PROXY` | So `req.ip` is the caller, not the load balancer. The rate limiter keys on it. |
| 2 | `pino-http` | Logs every request (except `/health`) with an id, status and time. Cookie and authorization headers are redacted. |
| 3 | `helmet` | Security headers on every answer, errors included: no `X-Powered-By`, `nosniff`, a strict Content-Security-Policy, HSTS and more. |
| 4 | `cors` | Only `CORS_ORIGIN` (the frontend) may call from a browser, with cookies (`credentials: true`). |
| 5 | `express.json({ limit: '100kb' })` | Parses JSON bodies. A bigger body is a 413, and broken JSON a 400, before any handler runs. |
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
- **CORS**: one allowed origin, from config. No wildcard, because the API will use cookies.
- **Rate limits**: per IP address. `/api` allows 1000 requests per 15 minutes (the frontend polls every 3 seconds while a sync runs). `POST /api/contact` allows 5 an hour. Answers carry the `RateLimit` and `RateLimit-Policy` headers (IETF draft 8).
- **Secrets**: only in `.env` (git-ignored), read only by `config.ts`, which stops the server at startup when one is missing or wrong. Logs redact cookies and authorization headers.
- **Database**: the server uses the Supabase secret key and checks access itself. Row level security is on for every table with no policies, so the public `anon` key can read nothing. See `docs/database.md`.
- **Errors**: a 500 never sends its message or stack to the caller.
- **Swagger**: served only when `NODE_ENV` is not `production`.

Planned with sign-in (step 3): an `httpOnly`, `Secure`, `SameSite=Lax` session cookie, sessions stored server-side so they can be revoked, protection against cross-site requests that change data, and per-user rate limits.

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
