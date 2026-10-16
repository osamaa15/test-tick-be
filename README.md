# Testick backend

The API for the Testick frontend: Express 5, TypeScript and Supabase. It answers what the frontend's `docs/api-contract.md` asks for.

## Run it

Needs Node 22.9 or newer, a Supabase project and a GitHub App (callback URL `http://localhost:4000/api/auth/github/callback`, repository permission Contents: read-only), installed on the accounts whose repositories you want to connect. Only those repositories are listed. Syncs also need the app's **App ID** and a **private key**, a **webhook** (below), an **AI key** (a free Gemini key from aistudio.google.com/apikey), and a **Resend** key (resend.com) to email contact messages. `.env.example` says where each value comes from.

```sh
npm install
cp .env.example .env      # then fill in the Supabase and GitHub values, and generate TOKEN_ENCRYPTION_KEY as it says
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push           # creates the tables
npm run dev               # http://localhost:4000
```

Try the API in Swagger at **http://localhost:4000/api/docs**. For routes behind sign-in, first open http://localhost:4000/api/auth/github in the same browser; the session cookie then goes with Swagger's requests. The raw OpenAPI document is at `/api/openapi.json`, for Postman or code generation. Both are off in production.

## Webhooks

A push starts a sync through the app's webhook. On the GitHub App's page:

1. **General > Webhook**: tick **Active**. **Webhook URL** is `API_URL` + `/api/webhooks/github`; **Webhook secret** is `GITHUB_WEBHOOK_SECRET` from `.env`.
2. **Permissions & events > Subscribe to events**: tick **Push**.

GitHub cannot reach `localhost`, so locally the webhook goes through a relay: open https://smee.io/new, use its address as the Webhook URL, and keep this running in a second terminal while you work:

```sh
npx smee-client --url https://smee.io/<your-channel> --target http://localhost:4000/api/webhooks/github
```

Connecting a repository starts its first sync without any webhook.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Starts the API and restarts on save |
| `npm run check` | Lint, typecheck and tests |
| `npm test` | Tests only |
| `npm run build` | Compiles to `dist/` |
| `npm start` | Runs `dist/`, as in production |
| `npm run db:push` | Applies new migrations to the linked Supabase project |
| `npm run db:types` | Regenerates the database types from the linked project |

## More

- `CLAUDE.md`: the rules, the folder structure and the roadmap
- `docs/architecture.md`: the request pipeline, errors, security, reliability and scaling
- `docs/database.md`: Supabase access, migrations and conventions
