-- The branch a project reads is chosen when its repository is connected, and never changes after: features and
-- scenarios come from that branch only. Before, it followed the repository's default branch on each push.
alter table public.projects rename column default_branch to branch;
comment on column public.projects.branch is 'The branch Testick reads, chosen when the repository was connected. Never changed.';

-- Unchanged but for the column's new name.
-- p_repos: [{ provider_repo_id, owner, name, visibility, branch }]
create or replace function public.connect_projects(p_user_id uuid, p_repos jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.projects (provider, provider_repo_id, owner, name, visibility, branch, connected_by)
  select 'github', r.provider_repo_id, r.owner, r.name, r.visibility, r.branch, p_user_id
  from jsonb_to_recordset(p_repos) as r (provider_repo_id text, owner text, name text, visibility text, branch text)
  on conflict (provider, provider_repo_id) do nothing;

  insert into public.syncs (project_id, branch)
  select pr.id, pr.branch
  from public.projects pr
  where pr.provider = 'github'
    and pr.provider_repo_id in (select r.provider_repo_id from jsonb_to_recordset(p_repos) as r (provider_repo_id text))
    and not exists (select 1 from public.syncs s where s.project_id = pr.id)
  -- Two people connecting the same repository at once start one sync, not two.
  on conflict (project_id) where status = 'running' do nothing;
$$;

-- Unchanged but for the column's new name.
create or replace function public.start_requested_sync(p_project_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  with requested as (
    update public.projects set resync = false
    where id = p_project_id and resync
    returning id, branch
  )
  insert into public.syncs (project_id, branch)
  select r.id, r.branch from requested r
  on conflict (project_id) where status = 'running' do nothing;
$$;

-- A push to the project's branch, or Sync now: starts a sync of that branch, or asks for one after the sync that is
-- running. The branch is the project's own, so a caller can no longer change it.
drop function public.request_sync(uuid, text);
create function public.request_sync(p_project_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into public.syncs (project_id, branch)
  select p.id, p.branch from public.projects p where p.id = p_project_id
  on conflict (project_id) where status = 'running' do nothing;
  if not found then
    update public.projects set resync = true where id = p_project_id;
  end if;
end
$$;

-- Also answers each project's branch.
drop function public.project_summaries(uuid, text[]);
create function public.project_summaries(p_user_id uuid, p_repo_ids text[])
returns table (
  id uuid,
  provider_repo_id text,
  branch text,
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
    select pr.id, pr.provider_repo_id, pr.branch
    from public.projects pr
    where pr.provider = 'github' and pr.provider_repo_id = any (p_repo_ids)
  ),
  f as (
    select * from public.feature_summaries(p_user_id, array(select p.id from p))
  )
  select
    p.id,
    p.provider_repo_id,
    p.branch,
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
  group by p.id, p.provider_repo_id, p.branch, latest.status, latest.started_at, latest.commit_sha
  order by latest.started_at desc
$$;

-- Supabase lets its public API roles execute new functions by default. These are the server's alone.
revoke execute on function public.request_sync(uuid) from public, anon, authenticated;
revoke execute on function public.project_summaries(uuid, text[]) from public, anon, authenticated;
grant execute on function public.request_sync(uuid) to service_role;
grant execute on function public.project_summaries(uuid, text[]) to service_role;
