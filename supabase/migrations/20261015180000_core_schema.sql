-- The core of Testick: people, connected repositories (projects), the features syncs found, the scenarios
-- written for them with the team's results, and the history of syncs. Read by every endpoint from step 3 on.
-- Every table has row level security on and no policies: only the backend reads or writes (docs/database.md).

create table public.users (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github')),
  -- The person's id on the provider. Unlike the handle, it never changes.
  provider_user_id text not null,
  name text not null,
  username text not null,
  avatar_url text,
  -- Null until they choose it after their first sign-in.
  role text check (role in ('tester', 'developer')),
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

-- A connected repository. Who may see it is not stored: it is whoever can access the repository on the provider.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github')),
  provider_repo_id text not null,
  owner text not null,
  name text not null,
  visibility text not null check (visibility in ('public', 'private')),
  default_branch text not null,
  connected_by uuid references public.users on delete set null,
  created_at timestamptz not null default now(),
  unique (provider, provider_repo_id)
);
create index on public.projects (connected_by);

-- One run that read a push. The newest one that succeeded is the project's current sync.
create table public.syncs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  branch text not null,
  -- The commit it read, null while not known yet. The API shows the short hash.
  commit_sha text,
  commit_message text,
  commit_author text,
  -- One sentence for people on why it stopped. Set only when it failed.
  failure text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'failed') = (failure is not null)),
  check ((status = 'running') = (finished_at is null))
);
create index on public.syncs (project_id, started_at desc);
-- A push webhook and Sync now must never run two syncs of one project at once.
create unique index syncs_one_running_per_project on public.syncs (project_id) where status = 'running';

create table public.features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  -- One sentence on what it does, written by Testick.
  description text not null check (char_length(description) <= 1000),
  created_at timestamptz not null default now()
);
create index on public.features (project_id);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  -- The order scenarios were written in. Lists sort by it.
  seq bigint generated always as identity,
  feature_id uuid not null references public.features on delete cascade,
  role text not null check (role in ('tester', 'developer')),
  kind text not null check (kind in ('happy-path', 'negative', 'validation', 'edge-case', 'security')),
  title text not null check (char_length(title) between 1 and 300),
  preconditions text check (char_length(preconditions) <= 2000),
  steps text[] not null default '{}' check (cardinality(steps) <= 50),
  expected text not null check (char_length(expected) between 1 and 2000),
  origin text not null check (origin in ('ai', 'edited', 'manual')),
  -- The team's result: one per scenario, shared by everyone, cleared when a sync finds the feature changed.
  verdict text check (verdict in ('passed', 'failed')),
  -- Null with a verdict once the person who marked it deleted their account.
  marked_by uuid references public.users on delete set null,
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((verdict is null) = (marked_at is null))
);
create index on public.scenarios (feature_id, role, seq);
create index on public.scenarios (marked_by);

-- Every feature as each finished sync left it, for the sync history.
create table public.sync_features (
  sync_id uuid not null references public.syncs on delete cascade,
  feature_id uuid not null references public.features on delete cascade,
  -- What this sync did to the feature, or null when it did not touch it.
  change text check (change in ('added', 'changed')),
  -- Counts per role as they stood when the next sync finished, shaped as the API's
  -- Record<Role, ScenarioSummary>. Null while this is the current sync: its counts are live from scenarios.
  scenarios jsonb,
  primary key (sync_id, feature_id)
);
create index on public.sync_features (feature_id);

-- The New or Changed mark is per person: a feature the current sync added or changed is marked for
-- everyone until they open it, which records that they saw it as of that sync.
create table public.feature_views (
  user_id uuid not null references public.users on delete cascade,
  feature_id uuid not null references public.features on delete cascade,
  sync_id uuid not null references public.syncs on delete cascade,
  primary key (user_id, feature_id)
);
create index on public.feature_views (feature_id);
create index on public.feature_views (sync_id);

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.syncs enable row level security;
alter table public.features enable row level security;
alter table public.scenarios enable row level security;
alter table public.sync_features enable row level security;
alter table public.feature_views enable row level security;
