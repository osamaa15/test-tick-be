---
name: check
description: Run the Testick backend quality gate (lint, typecheck, tests) and fix what fails. Use after changing any backend code and before reporting work as done.
---

# Check the backend

Work in the main conversation: do not hand any of this to a subagent or background agent, and leave nothing running in the background.

From `backend/`:

1. `npm run check` (lint, then `tsc --noEmit`, then the tests). Cut long output down, for example `2>&1 | tail -n 40`.
2. If the change touched startup, middleware, Swagger or the build, also run the compiled app once, inside one foreground command that stops it:

   ```sh
   npm run build && (NODE_ENV=development LOG_LEVEL=warn SUPABASE_URL=http://localhost:54321 SUPABASE_SECRET_KEY=x PORT=4123 node dist/server.js & PID=$!; sleep 2; curl -s localhost:4123/health; curl -s -o /dev/null -w "%{http_code}\n" localhost:4123/api/docs/; kill $PID)
   ```

   Expect `{"status":"ok"}` and `200`. Use the real `.env` instead of the placeholder values only to try an endpoint that needs the database.

- Fix the cause. Never silence a failure with `any`, `@ts-ignore`, a disabled lint rule, a skipped test or a loosened check.
- A new route that is missing from `/api/openapi.json`, or has no test for its error answers, is unfinished.
- Report what ran and what passed. Say plainly what could not be checked, such as a query that needs a linked Supabase project.
