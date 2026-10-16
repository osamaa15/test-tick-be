# Architecture

How a request moves through the backend, what keeps it safe, and what has to change when it runs at a larger scale.

## A request, in order

`createApp()` in `src/app.ts` sets up the middleware in this order. The order is deliberate.

| Step | What | Why here |
| --- | --- | --- |
| 1 | `trust proxy` = `TRUST_PROXY` | So `req.ip` is the caller, not the load balancer. The rate limiter keys on it. |
| 2 | `pino-http` | Logs one entry per request (except `/health`): id, method, path, status and time. No headers and no query string, which can carry a one-time sign-in code. |
| 3 | `helmet` | Security headers on every answer, errors included: no `X-Powered-By`, `nosniff`, a strict Content-Security-Policy, HSTS and more. |
| 4 | `cors` | Only `FRONTEND_URL` may call from a browser, with cookies (`credentials: true`). |
| 4b | `/api/webhooks` + `limitRequests(1000, 15)` | GitHub's webhooks, before the JSON parser: their signature is checked over the body exactly as sent (`express.raw`, 1 MB). |
| 5 | `express.json({ limit: '100kb' })` | Parses JSON bodies. A bigger body is a 413, and broken JSON a 400, before any handler runs. |
| 5b | `cookie-parser` | Fills `req.cookies`, where the session and sign-in state cookies are read. |
| 6 | `GET /` and `GET /health` | `/` says the API is live (and links the docs outside production); `/health` is for uptime checks. Before the rate limit, so they are never refused. Neither touches the database, so a database outage does not make the host restart a healthy server. |
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
- **Rate limits**: per IP address. `/api` allows 1000 requests per 15 minutes (the frontend polls every 3 seconds while a sync runs). `POST /api/contact` allows 5 an hour. Sign-in (`/api/auth/github` and its callback together) allows 20 per 15 minutes. `GET /api/repositories` (asks GitHub every time) allows 60 per 15 minutes, and connecting (`POST /api/projects`) 30. Changes to scenarios (marking a result, adding, editing) share one count of 300 per 15 minutes. Regenerating (an AI call, slow and limited on free tiers) allows 20 an hour. Webhooks allow 1000 per 15 minutes. Answers carry the `RateLimit` and `RateLimit-Policy` headers (IETF draft 8).
- **Secrets**: only in `.env` (git-ignored), read only by `config.ts`, which stops the server at startup when one is missing or wrong. Request logs carry no headers or query strings, and the logger also redacts cookie and authorization headers anywhere they appear.
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

Not built yet: revoking the GitHub token on disconnect (planned in Settings).

### Webhooks

GitHub signs every delivery with `GITHUB_WEBHOOK_SECRET` (HMAC-SHA256 in `X-Hub-Signature-256`). An unsigned or wrongly signed body is a 401, checked in constant time before the body is parsed. A push to a connected repository's default branch calls `request_sync`; every other event is answered 202 and ignored.

## Syncs

A sync reads one push and leaves the project's features and scenarios as the code now is.

1. **Queue.** The `syncs` table is the queue: a `running` sync is a job. Connecting a repository (`connect_projects`) and a push (`request_sync`) insert one. A push while one runs sets `projects.resync`, and one more sync starts when that one ends, so the newest commit is always read.
2. **Worker.** `startSyncWorker()` (started by `server.ts`) claims the oldest running sync with `claim_sync` (`FOR UPDATE SKIP LOCKED`, so instances never take the same one), polling every 5 seconds, or at once after a webhook. It renews its claim every minute; a claim older than 5 minutes means its worker stopped, and another takes the sync over. After 3 claims the sync is failed.
3. **Reading.** An installation token for that one repository (contents, read-only) reads the branch's newest commit, which is recorded on the sync at once, then the whole repository as one archive. Only code and docs are kept: no dependencies, builds, media, lock files or files over 100 KB, at most 20 MB of text from at most a 200 MB download. When the commit is the one the current sync read, nothing is read and every feature stays as it is.
4. **Features.** The AI gets the file list, as much code as fits in about 75k tokens, and the existing features (`syncs/plan.ts`), and answers at most 30 features, each with its files. A feature is matched to an existing one by name: a new name is `added`, and one whose files' contents hash differently is `changed`.
5. **Scenarios.** For each added or changed feature, the AI writes 4 to 8 scenarios per role from that feature's files (`scenarios/writer.ts`), two features at a time.
6. **Finishing.** `finish_sync` does it all in one transaction: freezes the previous sync's counts, saves the features, replaces the AI scenarios of changed features and clears their results, records the history, and marks the sync succeeded. A worker that lost its claim cannot finish.
7. **Failing.** A known cause (the app is not installed, no commits, the repository is too large, the AI could not answer) becomes the sync's `failure` in plain words; anything else is logged and shown as a general sentence. A failed sync changes nothing else.

The AI (`src/lib/ai.ts`) is any OpenAI-compatible chat API, Gemini by default. It answers in structured output (`response_format` with a JSON schema made from a Zod schema), and the answer is parsed with that schema. Busy or rate-limited answers (429, 5xx) are retried three times, waiting 20, 40 and 60 seconds, which free tiers need. Text is cut to the database's limits, and a scenario without a title or expected result is dropped.

### GitHub access

- **Who sees what.** `accessibleRepositories(userId)` (`features/projects/repositories.ts`) lists, with the person's own token, every installation of the Testick app they can access (`GET /user/installations`) and each one's repositories (`GET /user/installations/:id/repositories`). GitHub answers with the person's permission on each repository: admin or maintain makes them a Lead there. A project is visible exactly when its repository is in that list; otherwise it is a 404.
- **Cache.** That list is kept for 60 seconds per person, so the 3-second polling while a sync runs reads GitHub once a minute. `GET /api/repositories` always reads it fresh (and refreshes the cache), because people arrive there after changing the app's access on GitHub. Losing access therefore takes up to a minute to show.
- **Token renewal.** GitHub App user tokens last 8 hours. `asGitHubUser` (`features/auth/tokens.ts`) renews one a minute before it runs out and stores the new pair sealed. A refresh token works once, so a process renews each person's token one request at a time, and a renewal that GitHub refuses rereads the stored tokens in case another server just renewed them.
- **Ended sign-in.** When GitHub refuses the token (the person revoked the app, or the refresh token ran out after 6 months unused), or the stored tokens cannot be opened (`TOKEN_ENCRYPTION_KEY` changed), all the person's sessions are deleted and the request answers 401 "Your GitHub sign-in has ended. Sign in again." `GET /api/session` then answers `null`, and the frontend shows sign-in.
- A GitHub outage or rate limit is a 500 that is logged, like any other failure. Nothing is cached from a failed read.

## Reliability

- **Fail fast**: wrong configuration stops the server at startup with a list of what is wrong.
- **Timeouts**: every Supabase call is aborted after 10 seconds. Node's own server timeouts stay at their defaults.
- **Graceful shutdown**: on `SIGTERM` or `SIGINT` the server stops taking connections, finishes the requests in flight, and exits. If that takes over 10 seconds it exits anyway. The sync worker stops claiming; a sync it was running is taken over by another worker when its claim runs out.
- **Crashes**: an unhandled promise rejection stops the process (Node's default), and the host restarts it. That beats running on in an unknown state.
- **Logs**: one JSON object per line in production, so any log tool can search by request id, status or path. Readable lines in development (`pino-pretty`).
- **Source maps**: `npm start` runs with `--enable-source-maps`, so stack traces point at the TypeScript lines.

## Scaling

The app keeps no state in memory between requests apart from the rate-limit counts and the one-minute cache of GitHub access, so more instances can run behind a load balancer. Before that happens:

| Limit today | Change when |
| --- | --- |
| Rate-limit counts live in each process (`shortcut:` in `src/lib/rateLimit.ts`), keyed by IP address, so a team behind one office address shares one limit | More than one instance runs: give `limitRequests` a shared store such as `rate-limit-redis`. Teams hit 429s together: key signed-in requests by person. |
| GitHub access is cached in each process (`shortcut:` in `features/projects/repositories.ts`) | More than one instance runs: move it to the same Redis. |
| Token renewal is one at a time per process only | Several instances renew the same person's token at the same moment often enough to sign people out: lock the `provider_tokens` row around the renewal in a Postgres function. |
| Repository pages are read from GitHub one after another (`shortcut:` in `features/projects/repositories.ts`) | Someone has thousands of repositories: read the remaining pages in parallel. |
| The sync worker runs inside each API process, one sync at a time (`shortcut:` in `features/syncs/worker.ts`) | Syncs queue up or slow the API: start the worker from its own entry point and run as many as needed; claims already allow it. |
| Gemini's free tier: low requests-per-minute and daily limits, and Google may use the code sent | Real teams use it: a paid key (same settings), or another provider through `AI_BASE_URL` and `AI_MODEL`. |
| Compression is left to the host or proxy | The app is served without a proxy that compresses. |

## Adding to it

- A new endpoint: the `new-endpoint` skill.
- A new table: the `new-migration` skill.
- A new setting: add it to `Env` in `src/config.ts` and to `.env.example`, with a line saying what it is.
