# Testick backend

The API behind the Testick frontend (`../frontend`). Testick connects to a team's Git provider (GitHub first), finds a project's features, and uses AI to write plain-English test scenarios for Testers and Developers. Product behaviour and vocabulary are in `../frontend/docs/product.md`. **What every endpoint must accept and return is `../frontend/docs/api-contract.md`**, with the exact types in `../frontend/src/features/<name>/types.ts`. The backend builds against those files; when they disagree with this code, they win, or ask the user.

## Status

Built:

- Step 1, the foundation. Express 5 + TypeScript, config checked at startup, security headers, CORS, rate limits, request logs, one error format, Swagger, graceful shutdown, tests, and `POST /api/contact` (stored, not emailed yet).
- Step 2, the database: `users`, `projects`, `syncs`, `features`, `scenarios` (with the team's result), `sync_features` (history) and `feature_views` (New or Changed marks), pushed to the linked Supabase project. How they map to the API is in `docs/database.md`. Postgres functions for regenerating and finishing a sync come with their endpoints.

Roadmap, one step at a time:

1. ~~Foundation and contact~~
2. ~~Database tables for users, projects, features, scenarios, results and syncs~~
3. Sign in with GitHub and session cookies: `/api/session`, `/api/auth/*`, `/api/me`
4. Projects and repositories, read from the provider
5. Scenarios: read a feature, mark results, add, edit, regenerate
6. Syncs: push webhooks, a job queue, AI writing scenarios
7. Contact emails, and the frontend's services switched from mocks to this API

Not decided yet (ask the user when the step comes): GitHub OAuth App or GitHub App, the AI and email providers, hosting.

Stack: Node 22, Express 5, TypeScript, Zod 4 (validation and OpenAPI), Supabase (Postgres) through `@supabase/supabase-js`, pino logs, helmet, express-rate-limit, swagger-ui-express, `node:test` through tsx, oxlint. Versions are in `package.json`.

## Commands

- `npm run dev` starts the API at http://localhost:4000 and restarts on save. Swagger: http://localhost:4000/api/docs
- `npm run check` runs lint, typecheck and tests (`check` skill)
- `npm run build` then `npm start` runs the compiled app, as in production
- `npm run db:push` applies `supabase/migrations` to the linked project; `npm run db:types` regenerates `src/lib/database.types.ts`

## Folder structure

```
src/
  server.ts            listens and shuts down gracefully. Nothing else.
  app.ts               builds the app: middleware in order, routers, Swagger, 404, errors
  config.ts            every environment variable, checked with Zod at startup
  lib/                 shared plumbing: logger, errors, rateLimit, openapi, supabase, database.types
  features/<name>/     one area of the API contract (contact, later auth, projects, scenarios, syncs):
    schemas.ts           Zod schemas for requests and responses, named as in the frontend's types.ts
    routes.ts            the router: each route's OpenAPI registration sits right above it
    service.ts           database and provider calls. No Express in here.
  **/*.test.ts         tests beside the code they test
supabase/migrations/   the database schema, one SQL file per change, never edited after it is pushed
```

## Rules

- **Validate at the edge.** Every request body, param and query is parsed with its Zod schema in the handler (`Schema.parse(req.body)`). A `ZodError` becomes a 400 by itself. Never trust a value the client sent before that.
- **Errors.** Throw `HttpError(status, message)` for the caller's mistakes, with a message written for people. Anything else is a 500 that is logged and never shown. Express 5 passes a rejected promise to the error handler: no try/catch just to forward it. The format is in `docs/architecture.md`.
- **404 for "not yours".** A thing the person may not see answers 404, exactly like one that does not exist, so the API never reveals what exists.
- **Every route is in Swagger.** Register it with `registry.registerPath` directly above the route, using the same Zod schemas the handler parses. A route missing from `/api/docs` is unfinished.
- **Rate limits.** `/api` has a generous limit for everyone. A public route, or one that writes, costs money or sends something, adds its own lower `limitRequests(...)`.
- **Secrets** live only in `.env` and are read only through `config.ts`. The Supabase secret key never reaches a response, a log or the frontend.
- **Database.** Every table has row level security on and no policies; only this server reads or writes. Changes go in a new migration (`new-migration` skill). Rules in `docs/database.md`.
- **Responses match the frontend's types**: camelCase fields, string ids, ISO date strings. Turn snake_case rows into those shapes in `service.ts`.
- TypeScript: no `any`, no enums (union types or `z.enum`), `import type` for types, `.js` at the end of relative imports. Named exports. No `index.ts` barrels.
- New non-trivial logic gets a test. Tests use `node:test` and `fetch` against `createApp()` on port 0.
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
