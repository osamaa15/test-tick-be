-- Messages visitors send from the public contact page (POST /api/contact).

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) <= 320),
  topic text not null check (topic in ('question', 'feedback', 'bug', 'other')),
  message text not null check (char_length(message) between 10 and 5000),
  created_at timestamptz not null default now()
);

-- No policies on purpose: only the backend, with the secret key, reads or writes it. See docs/database.md.
alter table public.contact_messages enable row level security;
