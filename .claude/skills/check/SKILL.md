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
   npm run build && (NODE_ENV=development LOG_LEVEL=warn SUPABASE_URL=http://localhost:54321 SUPABASE_SECRET_KEY=x GITHUB_CLIENT_ID=x GITHUB_CLIENT_SECRET=x GITHUB_APP_ID=1 GITHUB_APP_PRIVATE_KEY=$(node -e "process.stdout.write(Buffer.from(require('crypto').generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'))") GITHUB_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx AI_API_KEY=x RESEND_API_KEY=x CONTACT_INBOX=team@example.com TOKEN_ENCRYPTION_KEY=$(node -e "process.stdout.write(Buffer.alloc(32).toString('base64'))") PORT=4123 node dist/server.js & PID=$!; sleep 2; curl -s localhost:4123/health; curl -s -o /dev/null -w "%{http_code}\n" localhost:4123/api/docs/; kill $PID)
   ```

   Expect `{"status":"ok"}` and `200`. With placeholders the sync worker logs that it cannot reach the database; that is expected. Use the real `.env` only to try an endpoint that needs the database: the worker is then real too, and runs any sync that is waiting.

   Run the built `node dist/server.js`, not `tsx`: tsx starts a child process that `kill $PID` misses, and it keeps the port. Afterwards, `curl -s -m 2 localhost:4123/health` must fail.

- Fix the cause. Never silence a failure with `any`, `@ts-ignore`, a disabled lint rule, a skipped test or a loosened check.
- A new route that is missing from `/api/openapi.json`, or has no test for its error answers, is unfinished.
- Report what ran and what passed. Say plainly what could not be checked, such as a query that needs a linked Supabase project.
