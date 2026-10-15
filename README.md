# Testick backend

The API for the Testick frontend: Express 5, TypeScript and Supabase. It answers what the frontend's `docs/api-contract.md` asks for.

## Run it

Needs Node 22.9 or newer, a Supabase project and a GitHub App (callback URL `http://localhost:4000/api/auth/github/callback`, repository permission Contents: read-only).

```sh
npm install
cp .env.example .env      # then fill in the Supabase and GitHub values, and generate TOKEN_ENCRYPTION_KEY as it says
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push           # creates the tables
npm run dev               # http://localhost:4000
```

Try the API in Swagger at **http://localhost:4000/api/docs**. For routes behind sign-in, first open http://localhost:4000/api/auth/github in the same browser; the session cookie then goes with Swagger's requests. The raw OpenAPI document is at `/api/openapi.json`, for Postman or code generation. Both are off in production.

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
