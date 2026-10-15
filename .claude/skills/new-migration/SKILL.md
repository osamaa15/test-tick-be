---
name: new-migration
description: Add or change Supabase tables, columns, indexes or Postgres functions for the Testick backend with a new SQL migration, then regenerate the types. Use when a feature needs a table, a column, an index, or an atomic database operation.
---

# Add a migration

Work in the main conversation. No subagents, nothing left running in the background.

1. Read `docs/database.md`: the conventions and the current tables.
2. Create `supabase/migrations/<YYYYMMDDHHMMSS>_<what_it_does>.sql`, with a timestamp later than every existing file. Never edit a migration that is already pushed; write a new one that changes it.
3. In the SQL:
   - A comment on the first line saying what it is for, and which endpoint uses it.
   - `uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`.
   - `text` + `check (x in (...))` for fixed sets of values, and `check` constraints for lengths that protect the data.
   - Foreign keys with an explicit `on delete`, and an index on each foreign key and on every column lists filter or sort by.
   - `alter table public.<name> enable row level security;` for every new table, with no policies.
   - Writes that must happen together (replace scenarios, finish a sync) as a `create function ... language plpgsql` called with `supabase.rpc`. Set `security invoker` and `set search_path = ''`, and write table names in full (`public.scenarios`).
4. Apply and type it:
   - Linked project: `npm run db:push`, then `npm run db:types`.
   - Not linked yet: tell the user to run those two commands, and update `src/lib/database.types.ts` by hand in the generated shape (Row, Insert, Update, Relationships) so the code typechecks now.
5. Add the table to the Tables list in `docs/database.md`, then run the `check` skill.

Never run a migration that drops or rewrites data without telling the user what will be lost and getting a yes first.
