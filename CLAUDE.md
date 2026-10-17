# Testick backend

The API behind the Testick frontend (`../frontend`). Testick connects to a team's Git provider (GitHub first), finds a project's features, and uses AI to write plain-English test scenarios for Testers and Developers. Product behaviour and vocabulary are in `../frontend/docs/product.md`. **What every endpoint must accept and return is `../frontend/docs/api-contract.md`**, with the exact types in `../frontend/src/features/<name>/types.ts`. The backend builds against those files; when they disagree with this code, they win, or ask the user.

## Status

Built:

- Step 1, the foundation. Express 5 + TypeScript, config checked at startup, security headers, CORS, rate limits, request logs, one error format, Swagger, graceful shutdown, tests, and `POST /api/contact` (stored, and since step 7 emailed to the team).
- Step 2, the database: `users`, `projects`, `syncs`, `features`, `scenarios` (with the team's result), `sync_features` (history) and `feature_views` (New or Changed marks), pushed to the linked Supabase project. How they map to the API is in `docs/database.md`. Each later step adds the Postgres functions its endpoints need.
- Step 3, sign-in: `GET /api/auth/github` and its callback (GitHub App user sign-in with a state cookie), `GET /api/session`, `POST /api/auth/sign-out`, `PATCH /api/me`. Sessions live in the `sessions` table behind an httpOnly cookie, and GitHub tokens are stored sealed (AES-256-GCM) in `provider_tokens`. Sign-in ends on the frontend's `/auth/callback`.
- Step 4, projects: `GET /api/repositories`, `POST /api/projects`, `GET /api/projects`, `GET /api/projects/:projectId`, and `DELETE /api/projects/:projectId` (a Lead removes it from Testick with everything stored for it; the repository on GitHub is untouched), and `GET /api/repositories/:repositoryId/branches`: connecting chooses the branch a project reads (`projects.branch`), which never changes after; only pushes to it start syncs. Who may see a project, and who is a Lead, is read from GitHub with the person's own token (`features/auth/tokens.ts` renews it every 8 hours) and kept for a minute per person. Counts and New or Changed marks come from Postgres functions (`docs/database.md`). Connecting starts the project's first sync.
- Step 5, scenarios: `GET /api/projects/:projectId/features/:featureId` (also clears the person's New or Changed mark), `PUT /api/scenarios/:scenarioId/result`, `POST /api/features/:featureId/scenarios`, `PATCH /api/scenarios/:scenarioId`. Access to a feature or scenario is its project's repository. `POST /api/features/:featureId/regenerate` came with step 6, because it needs the AI and the feature's code.
- Step 6, syncs: the sync worker (`features/syncs/worker.ts`, started by `server.ts`) takes running syncs from the `syncs` table, reads the push as the GitHub App, has the AI find the features and write scenarios for new and changed ones, and ends the sync with `finish_sync`. `POST /api/webhooks/github` (signed) starts a sync on a push to the default branch. `POST /api/features/:featureId/regenerate` and `GET /api/projects/:projectId/syncs`. How it works is in `docs/architecture.md` (Syncs).
- Step 7a, contact emails: each contact message is stored, then emailed to `CONTACT_INBOX` through Resend with the visitor as reply-to. A failed email is logged and loses nothing.
- After step 7, a used-up Gemini day: a model whose daily requests are used up is skipped, and when all are, syncs and Regenerate stop at once with a clear message instead of retrying for minutes. The server prefers IPv4, because some networks reset IPv6 connections to Gemini.
- After step 7, the rest of the product spec: `DELETE /api/scenarios/:scenarioId`, Sync now (`POST /api/projects/:projectId/syncs`, a sync as a push starts one), `POST /api/auth/disconnect` (takes back the GitHub authorization, forgets the tokens, ends every session) and `DELETE /api/me` (disconnects, then deletes the account; their results stay for the team).
- The board: `GET /api/projects/:projectId/board` (every scenario of the current features) and `PUT /api/scenarios/:scenarioId/status` (`to-do`, `in-progress`, `passed`, `failed`). In progress is a scenario someone took (`scenarios.assigned_to`) and nobody marked. Third-party boards (Jira, Trello, Asana) are for later.
- Step 7b, the frontend (`../frontend`) calls this API: its services use `/api`, which Vite forwards to `http://localhost:4000` in development, and sign-in returns to its `/auth/callback` page. Its fake backend is gone, so the frontend needs this API running.

Roadmap, one step at a time:

1. ~~Foundation and contact~~
2. ~~Database tables for users, projects, features, scenarios, results and syncs~~
3. ~~Sign in with GitHub and session cookies: `/api/session`, `/api/auth/*`, `/api/me`~~
4. ~~Projects and repositories, read from the provider~~
5. ~~Scenarios: read a feature, mark results, add, edit~~
6. ~~Syncs: push webhooks, a job queue, AI writing scenarios, regenerate, `GET /api/projects/:projectId/syncs`~~
7. ~~Contact emails, and the frontend's services switched from mocks to this API~~

Decided: Testick is a **GitHub App** (not an OAuth App). People sign in through it, it reads repositories with fine-grained read-only permissions, and push webhooks come from its installations. A person sees the repositories they can access on the installations of the app. Syncs read code as the app itself (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`), with installation tokens scoped to one repository, read-only. Webhooks need the app's webhook switched on, with the Push event (README).

Decided: the AI is **Gemini** (`gemini-3.6-flash`, falling back to `gemini-3.8-flash` and `gemini-3-flash-preview` when busy; free tier) through its OpenAI-compatible API, in `src/lib/ai.ts`. Any OpenAI-compatible provider works by changing `AI_BASE_URL` and `AI_MODEL`. On Gemini's free tier Google may use what is sent, repository code included, to improve its products; a paid key does not.

Decided: **Resend** sends email (free tier; `onboarding@resend.dev` until a domain is verified there).

Not decided yet: hosting. The frontend is on Vercel; this API runs locally until the MVP is complete, then the user chooses a host with its cost (ask then). Hosting it means a rewrite of `/api/:path*` to it in the frontend's `vercel.json`, and the GitHub App's callback and webhook URLs pointed at it.

Stack: Node 22, Express 5, TypeScript, Zod 4 (validation and OpenAPI), Supabase (Postgres) through `@supabase/supabase-js`, pino logs, helmet, express-rate-limit, swagger-ui-express, `node:test` through tsx, oxlint, `tar` (reads repository archives). The AI is called with `fetch`, without an SDK. Versions are in `package.json`.

## Commands

- `npm run dev` starts the API at http://localhost:4000 and restarts on save. Swagger: http://localhost:4000/api/docs
- `npm run check` runs lint, typecheck and tests (`check` skill). GitHub Actions runs it on every push to main and every pull request (`.github/workflows/check.yml`)
- `npm run build` then `npm start` runs the compiled app, as in production
- `npm run db:push` applies `supabase/migrations` to the linked project; `npm run db:types` regenerates `src/lib/database.types.ts`

## Folder structure

```
src/
  server.ts            listens, starts the sync worker, and shuts both down gracefully. Nothing else.
  app.ts               builds the app: middleware in order, routers, Swagger, 404, errors
  config.ts            every environment variable, checked with Zod at startup
  testServer.ts        test helper: fake config and the app on a free port (not built)
  lib/                 shared plumbing: logger, errors, rateLimit, openapi, supabase, database.types, crypto,
                       github (REST calls), githubApp (the app's JWT, installation tokens, files), ai (the AI)
  features/<name>/     one area of the API contract (auth, contact, projects, scenarios, syncs):
    schemas.ts           Zod schemas for requests and responses, named as in the frontend's types.ts
    routes.ts            the router: each route's OpenAPI registration sits right above it
    service.ts           database and provider calls. No Express in here.
    (more files)         when service.ts would do two jobs: auth/tokens.ts (GitHub tokens), projects/repositories.ts (access from GitHub),
                         scenarios/writer.ts (the AI writes scenarios), syncs/code.ts, plan.ts and worker.ts (the sync worker)
  **/*.test.ts         tests beside the code they test
supabase/migrations/   the database schema, one SQL file per change, never edited after it is pushed
```

## Rules

- **Validate at the edge.** Every request body, param and query is parsed with its Zod schema in the handler (`Schema.parse(req.body)`). A `ZodError` becomes a 400 by itself. Never trust a value the client sent before that.
- **Errors.** Throw `HttpError(status, message)` for the caller's mistakes, with a message written for people. Anything else is a 500 that is logged and never shown. Express 5 passes a rejected promise to the error handler: no try/catch just to forward it. The format is in `docs/architecture.md`.
- **Sign-in.** A route behind sign-in starts with `const { user } = await requireSession(req)` (from `features/auth/session.ts`), declares `security: [{ [sessionCookie.name]: [] }]` in Swagger, and has a test that it answers 401 without a cookie. Other features may import `features/auth/session.ts`, `schemas.ts` and `tokens.ts`, `features/projects/repositories.ts` (who may see a project) and `schemas.ts`, and `features/scenarios/writer.ts`; nothing else from another feature.
- **GitHub as the person.** Every call with a person's token goes through `asGitHubUser(userId, call)` from `features/auth/tokens.ts`: it renews the token, and when GitHub no longer takes it, ends their sessions and answers 401. Never read `provider_tokens` anywhere else. Reading code as the app goes through `installationToken` in `lib/githubApp.ts`.
- **Syncs run in the worker, never in a request.** Something that needs a sync inserts a running one (`request_sync`); the worker claims it. Regenerating is the one AI call inside a request, because the frontend waits for its answer.
- **404 for "not yours".** A thing the person may not see answers 404, exactly like one that does not exist, so the API never reveals what exists.
- **Every route is in Swagger.** Register it with `registry.registerPath` directly above the route, using the same Zod schemas the handler parses. A route missing from `/api/docs` is unfinished.
- **Rate limits.** `/api` has a generous limit for everyone. A public route, or one that writes, costs money or sends something, adds its own lower `limitRequests(...)`.
- **Secrets** live only in `.env` and are read only through `config.ts`. The Supabase secret key, the GitHub client secret and every token never reach a response, a log or the frontend. Never print `.env` values: show names only (`sed -E 's/=.+/=<set>/' .env`). Provider tokens are stored only through `seal()` from `lib/crypto.ts`.
- **Database.** Every table has row level security on and no policies; only this server reads or writes. Changes go in a new migration (`new-migration` skill). Rules in `docs/database.md`.
- **Responses match the frontend's types**: camelCase fields, string ids, ISO date strings. Turn snake_case rows into those shapes in `service.ts`.
- TypeScript: no `any`, no enums (union types or `z.enum`), `import type` for types, `.js` at the end of relative imports. Named exports. No `index.ts` barrels.
- New non-trivial logic gets a test. Tests use `node:test` and `fetch` against `await startTestServer()` from `src/testServer.ts`, which fakes the config, so tests never reach the real database or GitHub. A test that needs the database is done by hand against the linked project, and cleans up after itself.
- Comment only the why. A known limit gets `// shortcut: <the limit>, <when to upgrade>`.

## Docs: read only what the task needs

| File | Read when |
| --- | --- |
| `../frontend/docs/api-contract.md` | You add or change an endpoint: what it must accept and return. |
| `../frontend/docs/product.md` | You need product behaviour: roles, Leads, results, syncs, vocabulary. |
| `docs/architecture.md` | You touch middleware, errors, security, rate limits, logging, or how the app scales. |
| `docs/database.md` | You add or change a table, a query, or a migration. |
| `README.md` | You change setup or commands. It is the short introduction for people. |
| `.claude/skills/<name>/SKILL.md` | You run the skill of that name (table below). |

- **Update this file in every change**: status, roadmap, structure, rules, commands, docs and skills stay true. Every `.md` file in the repo has a row in the table above.
- When a change makes a doc wrong, fix the doc in the same change.

## Skills

| Skill | Use for |
| --- | --- |
| `/new-endpoint` | Adding a route from the API contract: schema, service, route, Swagger, test. |
| `/new-migration` | Adding or changing tables in Supabase. |
| `/check` | Lint, typecheck and tests before calling work done. |

## Working rules

- Do all work in the main conversation. Never start a subagent or background agent (the Agent tool), and never leave a process running in the background: a server needed for a check starts and stops inside one foreground command. The user asked for this explicitly.
- Keep context small: never read `node_modules/`, `dist/` or `package-lock.json`.
- Never write to `../frontend` while working on the backend unless the user asks.
