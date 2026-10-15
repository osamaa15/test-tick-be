# Database

Supabase's Postgres, reached only from this server through `src/lib/supabase.ts`.

## Who can read what

- The server uses the **secret key** (`SUPABASE_SECRET_KEY`), which skips row level security. Testick decides access from the Git provider (a person sees a project when they can access its repository), and Postgres cannot know that, so the server checks access in each feature's `service.ts`.
- **Every table has row level security on, with no policies.** Supabase exposes `public` tables over its REST API to anyone holding the project's public `anon` key. With RLS on and no policies, that key reads and writes nothing. Only the server can.
- The frontend never talks to Supabase. It talks only to this API.

## Changing the schema

The schema lives in `supabase/migrations/`, one SQL file per change, applied in order of the timestamp in the file name.

1. Write a new file `supabase/migrations/<YYYYMMDDHHMMSS>_<what>.sql` (the `new-migration` skill). Never edit a migration that has been pushed: write another one that changes it.
2. `npm run db:push` applies new migrations to the linked project.
3. `npm run db:types` regenerates `src/lib/database.types.ts`, so the queries are typed from the real schema. Commit it with the migration.

The first time on a machine, link the project: `npx supabase login`, then `npx supabase link --project-ref <ref>` (the ref is in the project's URL).

Without the CLI, a migration can also be pasted into the Supabase SQL editor. Then update `database.types.ts` by hand, in the same shape.

## Conventions

- Tables: plural, `snake_case` (`contact_messages`). Columns: `snake_case`. The API answers in camelCase; `service.ts` maps one to the other.
- Ids: `uuid primary key default gen_random_uuid()`.
- Times: `timestamptz`, with `created_at timestamptz not null default now()` on every table.
- Fixed sets of values (topics, roles, statuses): `text` with a `check (x in (...))`. Easier to change later than a Postgres enum.
- Limits that protect the data (lengths, allowed values) are `check` constraints too, even though Zod checks them first.
- Foreign keys say what happens on delete (`on delete cascade` or `restrict`). Index every foreign key and every column a list is filtered or sorted by.
- Every new table ends with `alter table ... enable row level security;`.
- Something that must happen all together (replace a feature's AI scenarios, finish a sync) is a Postgres function called with `supabase.rpc(...)`, because each REST call is its own transaction.

## Tables

| Table | Holds | Since |
| --- | --- | --- |
| `contact_messages` | Messages from the public contact page: name, email, topic, message | Step 1 |

The tables for users, projects, features, scenarios, results and syncs come in step 2.
