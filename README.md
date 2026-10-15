# Testick backend

The API for the Testick frontend: Express 5, TypeScript and Supabase. It answers what the frontend's `docs/api-contract.md` asks for.

## Run it

Needs Node 22.9 or newer and a Supabase project.

```sh
npm install
cp .env.example .env      # then fill in SUPABASE_URL and SUPABASE_SECRET_KEY
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push           # creates the tables
npm run dev               # http://localhost:4000
```

Try the API in Swagger at **http://localhost:4000/api/docs**. The raw OpenAPI document is at `/api/openapi.json`, for Postman or code generation. Both are off in production.

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
