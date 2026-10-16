-- Projects (step 4): what GET /api/projects, GET /api/projects/:projectId, GET /api/repositories and
-- POST /api/projects read and write, one round trip each. The server passes the repositories the person can
-- access on the provider, because Postgres cannot know them. Only the server may call these functions.

-- The features of each project as its current sync (the newest that succeeded) left them, with this
-- person's New or Changed mark and the team's counts per role.
create function public.feature_summaries(p_user_id uuid, p_project_ids uuid[])
returns table (
  project_id uuid,
  id uuid,
  name text,
  description text,
  change text,
  tester_total int,
  tester_passed int,
  tester_failed int,
  developer_total int,
  developer_passed int,
  developer_failed int
)
language sql
stable
set search_path = ''
as $$
  with current_sync as (
    select distinct on (s.project_id) s.project_id, s.id
    from public.syncs s
    where s.project_id = any (p_project_ids) and s.status = 'succeeded'
    order by s.project_id, s.started_at desc
  )
  select
    f.project_id,
    f.id,
    f.name,
    f.description,
    -- Marked until this person opens the feature as of the current sync.
    case when v.sync_id is distinct from cs.id then sf.change end,
    (count(sc.id) filter (where sc.role = 'tester'))::int,
    (count(sc.id) filter (where sc.role = 'tester' and sc.verdict = 'passed'))::int,
    (count(sc.id) filter (where sc.role = 'tester' and sc.verdict = 'failed'))::int,
    (count(sc.id) filter (where sc.role = 'developer'))::int,
    (count(sc.id) filter (where sc.role = 'developer' and sc.verdict = 'passed'))::int,
    (count(sc.id) filter (where sc.role = 'developer' and sc.verdict = 'failed'))::int
  from current_sync cs
  join public.sync_features sf on sf.sync_id = cs.id
  join public.features f on f.id = sf.feature_id
  left join public.feature_views v on v.feature_id = f.id and v.user_id = p_user_id
  left join public.scenarios sc on sc.feature_id = f.id
  group by f.id, cs.id, sf.change, v.sync_id
  order by f.project_id, f.created_at, f.name
$$;

-- Each connected project among these repositories: its newest sync of any status, and its current
-- features' counts added up. Most recently synced first.
create function public.project_summaries(p_user_id uuid, p_repo_ids text[])
returns table (
  id uuid,
  provider_repo_id text,
  latest_status text,
  latest_started_at timestamptz,
  latest_commit_sha text,
  feature_count int,
  new_feature_count int,
  tester_total int,
  tester_passed int,
  tester_failed int,
  developer_total int,
  developer_passed int,
  developer_failed int
)
language sql
stable
set search_path = ''
as $$
  with p as (
    select pr.id, pr.provider_repo_id
    from public.projects pr
    where pr.provider = 'github' and pr.provider_repo_id = any (p_repo_ids)
  ),
  f as (
    select * from public.feature_summaries(p_user_id, array(select p.id from p))
  )
  select
    p.id,
    p.provider_repo_id,
    latest.status,
    latest.started_at,
    latest.commit_sha,
    count(f.id)::int,
    count(f.change)::int,
    coalesce(sum(f.tester_total), 0)::int,
    coalesce(sum(f.tester_passed), 0)::int,
    coalesce(sum(f.tester_failed), 0)::int,
    coalesce(sum(f.developer_total), 0)::int,
    coalesce(sum(f.developer_passed), 0)::int,
    coalesce(sum(f.developer_failed), 0)::int
  from p
  join lateral (
    select s.status, s.started_at, s.commit_sha
    from public.syncs s
    where s.project_id = p.id
    order by s.started_at desc
    limit 1
  ) latest on true
  left join f on f.project_id = p.id
  group by p.id, p.provider_repo_id, latest.status, latest.started_at, latest.commit_sha
  order by latest.started_at desc
$$;

-- Connects repositories as projects and starts each one's first sync, all together. A repository that is
-- already a project keeps it, and gets a sync only if it has none (so a half-finished connect heals).
-- p_repos: [{ provider_repo_id, owner, name, visibility, default_branch }]
create function public.connect_projects(p_user_id uuid, p_repos jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.projects (provider, provider_repo_id, owner, name, visibility, default_branch, connected_by)
  select 'github', r.provider_repo_id, r.owner, r.name, r.visibility, r.default_branch, p_user_id
  from jsonb_to_recordset(p_repos) as r (provider_repo_id text, owner text, name text, visibility text, default_branch text)
  on conflict (provider, provider_repo_id) do nothing;

  insert into public.syncs (project_id, branch)
  select pr.id, pr.default_branch
  from public.projects pr
  where pr.provider = 'github'
    and pr.provider_repo_id in (select r.provider_repo_id from jsonb_to_recordset(p_repos) as r (provider_repo_id text))
    and not exists (select 1 from public.syncs s where s.project_id = pr.id)
  -- Two people connecting the same repository at once start one sync, not two.
  on conflict (project_id) where status = 'running' do nothing;
$$;

-- Supabase lets its public API roles execute new functions by default. These are the server's alone.
revoke execute on function public.feature_summaries(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.project_summaries(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.connect_projects(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.feature_summaries(uuid, uuid[]) to service_role;
grant execute on function public.project_summaries(uuid, text[]) to service_role;
grant execute on function public.connect_projects(uuid, jsonb) to service_role;
