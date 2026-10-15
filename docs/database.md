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
| `users` | One per person and provider account: name, handle, avatar, their own `role` (null until chosen) | Step 2 |
| `projects` | Connected repositories: provider id, owner, name, visibility, default branch, who connected it | Step 2 |
| `syncs` | Every run that read a push: status, branch, commit, `failure` (only when failed), start and finish | Step 2 |
| `features` | What syncs found in a project: name and one-sentence description | Step 2 |
| `scenarios` | The test cases, per feature and role, with origin (`ai`, `edited`, `manual`) and the team's result (`verdict`, `marked_by`, `marked_at`) | Step 2 |
| `sync_features` | Every feature as each finished sync left it: what the sync did to it, and its frozen counts | Step 2 |
| `feature_views` | Which sync's New or Changed mark each person has cleared, per feature | Step 2 |
| `sessions` | One per signed-in browser: the SHA-256 of the cookie's token, the person, when it expires (30 days) | Step 3 |
| `provider_tokens` | Each person's GitHub access and refresh tokens, sealed with AES-256-GCM, and when they expire | Step 3 |

### How the API's ideas map to the tables

- **Lead and visibility** are not stored. Both come from the provider on each request: who can access the repository, and with what permission.
- **The current sync** is the project's newest `succeeded` sync. `latestSync` is its newest sync of any status. A unique index allows only one `running` sync per project.
- **The result** is three columns on `scenarios`, one per scenario for the whole team. A check keeps `verdict` and `marked_at` set or cleared together. A sync that finds a feature changed clears them.
- **Counts** (`total`, `passed`, `failed` per role) are added up from `scenarios` for the current sync. When the next sync finishes, the previous current sync's `sync_features.scenarios` is filled with the counts as they stood, as `{"tester": {...}, "developer": {...}}`. It stays null while that sync is current.
- **New or Changed** for a person: the current sync's `sync_features.change` for that feature, unless that person's `feature_views` row points at the current sync. Opening a feature upserts that row.
- **Regenerating** deletes one role's `origin = 'ai'` scenarios of a feature and inserts new ones. `edited` and `manual` ones stay, with their results. It becomes a Postgres function with its endpoint in step 5. Finishing a sync becomes one in step 6.
- **Order**: lists sort scenarios by `seq`, the order they were written in.
- **Secrets at rest**: a session token is stored only as its hash, and provider tokens only sealed. Someone who reads the tables can neither sign in as anyone nor call GitHub as them. Selecting from `users` never brings tokens with it.
