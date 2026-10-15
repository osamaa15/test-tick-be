-- Sign-in (step 3): who is signed in where, and the provider tokens Testick reads repositories with.
-- Used by /api/auth/github, /api/session, /api/auth/sign-out and every route that needs a session.

-- One row per signed-in browser. The cookie holds a random token; only its SHA-256 is stored, so a leaked
-- table cannot be replayed as cookies. Deleting a row signs that browser out.
create table public.sessions (
  token_hash text primary key,
  user_id uuid not null references public.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on public.sessions (user_id);
create index on public.sessions (expires_at);

-- The provider's tokens for each person, encrypted by the backend (AES-256-GCM with TOKEN_ENCRYPTION_KEY)
-- before they are stored. Kept apart from users so a query for people never carries them.
create table public.provider_tokens (
  user_id uuid primary key references public.users on delete cascade,
  access_token text not null,
  -- Null when the provider issues tokens that do not expire.
  access_token_expires_at timestamptz,
  refresh_token text,
  refresh_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.sessions enable row level security;
alter table public.provider_tokens enable row level security;
