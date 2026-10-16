-- Syncs (step 6): the worker that reads a push and writes scenarios, push webhooks, regenerating, and the
-- sync history. Every function here is the server's alone: execute is revoked from Supabase's public roles.

-- What tells a sync whether a feature's code changed: the files that implement it, and a hash of them.
alter table public.features
  add column paths text[] not null default '{}' check (cardinality(paths) <= 50),
  add column code_hash text;

-- The syncs table is the job queue: a running sync is a job. A worker claims one and renews the claim every
-- minute while it works; a claim older than 5 minutes means the worker stopped, and another worker takes it.
-- `attempts` counts claims, so a sync that keeps stopping its worker is failed instead of retried forever.
alter table public.syncs
  add column claimed_at timestamptz,
  add column attempts int not null default 0;
create index syncs_running on public.syncs (started_at) where status = 'running';

-- A push that arrives while a sync runs: one more sync starts when that one ends.
alter table public.projects add column resync boolean not null default false;

-- Takes the oldest running sync nobody is working on. SKIP LOCKED lets many workers claim side by side.
create function public.claim_sync()
returns setof public.syncs
language sql
volatile
set search_path = ''
as $$
  update public.syncs
  set claimed_at = now(), attempts = attempts + 1
  where id = (
    select s.id
    from public.syncs s
    where s.status = 'running' and (s.claimed_at is null or s.claimed_at < now() - interval '5 minutes')
    order by s.started_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

-- After a sync ends: starts the one a push asked for while it ran.
create function public.start_requested_sync(p_project_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  with requested as (
    update public.projects set resync = false
    where id = p_project_id and resync
    returning id, default_branch
  )
  insert into public.syncs (project_id, branch)
  select r.id, r.default_branch from requested r
  on conflict (project_id) where status = 'running' do nothing;
$$;

-- A push to the default branch: starts a sync, or asks for one after the sync that is running.
create function public.request_sync(p_project_id uuid, p_branch text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update public.projects set default_branch = p_branch where id = p_project_id;
  insert into public.syncs (project_id, branch) values (p_project_id, p_branch)
  on conflict (project_id) where status = 'running' do nothing;
  if not found then
    update public.projects set resync = true where id = p_project_id;
  end if;
end
$$;

-- Ends a sync that worked, all together. p_features is every feature the sync found:
-- [{ id (null when added), name, description, paths, code_hash, change, scenarios: [{ role, kind, title,
-- preconditions, steps, expected }] }], with scenarios only for features that were added or changed.
-- Returns false, changing nothing, when this worker no longer holds the sync (p_attempt is its claim).
create function public.finish_sync(p_sync_id uuid, p_attempt int, p_features jsonb)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_previous_id uuid;
  v_feature jsonb;
  v_feature_id uuid;
  v_change text;
begin
  select s.project_id into v_project_id
  from public.syncs s
  where s.id = p_sync_id and s.status = 'running' and s.attempts = p_attempt
  for update;
  if v_project_id is null then
    return false;
  end if;

  select s.id into v_previous_id
  from public.syncs s
  where s.project_id = v_project_id and s.status = 'succeeded'
  order by s.started_at desc
  limit 1;

  -- The sync that was current keeps its counts as they stand now, before this one clears any results.
  update public.sync_features sf
  set scenarios = c.counts
  from (
    select
      x.feature_id,
      jsonb_build_object(
        'tester', jsonb_build_object(
          'total', count(sc.id) filter (where sc.role = 'tester'),
          'passed', count(sc.id) filter (where sc.role = 'tester' and sc.verdict = 'passed'),
          'failed', count(sc.id) filter (where sc.role = 'tester' and sc.verdict = 'failed')),
        'developer', jsonb_build_object(
          'total', count(sc.id) filter (where sc.role = 'developer'),
          'passed', count(sc.id) filter (where sc.role = 'developer' and sc.verdict = 'passed'),
          'failed', count(sc.id) filter (where sc.role = 'developer' and sc.verdict = 'failed'))
      ) as counts
    from public.sync_features x
    left join public.scenarios sc on sc.feature_id = x.feature_id
    where x.sync_id = v_previous_id
    group by x.feature_id
  ) c
  where sf.sync_id = v_previous_id and sf.feature_id = c.feature_id;

  for v_feature in select * from jsonb_array_elements(p_features) loop
    v_change := v_feature->>'change';
    v_feature_id := (v_feature->>'id')::uuid;

    if v_feature_id is null then
      insert into public.features (project_id, name, description, paths, code_hash)
      values (
        v_project_id,
        v_feature->>'name',
        v_feature->>'description',
        array(select jsonb_array_elements_text(v_feature->'paths')),
        v_feature->>'code_hash'
      )
      returning id into v_feature_id;
    else
      update public.features
      set
        name = v_feature->>'name',
        description = v_feature->>'description',
        paths = array(select jsonb_array_elements_text(v_feature->'paths')),
        code_hash = v_feature->>'code_hash'
      where id = v_feature_id and project_id = v_project_id;
      if not found then
        raise exception 'feature % is not in project %', v_feature_id, v_project_id;
      end if;
    end if;

    if v_change = 'changed' then
      -- Its code changed: the AI's scenarios are rewritten, and every result needs checking again.
      delete from public.scenarios where feature_id = v_feature_id and origin = 'ai';
      update public.scenarios set verdict = null, marked_by = null, marked_at = null where feature_id = v_feature_id;
    end if;

    insert into public.scenarios (feature_id, role, kind, title, preconditions, steps, expected, origin)
    select v_feature_id, s.role, s.kind, s.title, s.preconditions, coalesce(s.steps, '{}'), s.expected, 'ai'
    from jsonb_to_recordset(coalesce(v_feature->'scenarios', '[]'))
      as s (role text, kind text, title text, preconditions text, steps text[], expected text);

    insert into public.sync_features (sync_id, feature_id, change) values (p_sync_id, v_feature_id, v_change);
  end loop;

  update public.syncs set status = 'succeeded', finished_at = now() where id = p_sync_id;
  perform public.start_requested_sync(v_project_id);
  return true;
end
$$;

-- Ends a sync that could not finish. It changes nothing else: features and results stay with the sync before.
create function public.fail_sync(p_sync_id uuid, p_attempt int, p_failure text)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  update public.syncs
  set status = 'failed', failure = p_failure, finished_at = now()
  where id = p_sync_id and status = 'running' and attempts = p_attempt
  returning project_id into v_project_id;
  if v_project_id is null then
    return false;
  end if;
  perform public.start_requested_sync(v_project_id);
  return true;
end
$$;

-- Regenerating: one role's AI scenarios of a feature are replaced. Edited and hand-written ones stay.
-- p_scenarios: [{ kind, title, preconditions, steps, expected }]
create function public.replace_ai_scenarios(p_feature_id uuid, p_role text, p_scenarios jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  delete from public.scenarios where feature_id = p_feature_id and role = p_role and origin = 'ai';
  insert into public.scenarios (feature_id, role, kind, title, preconditions, steps, expected, origin)
  select p_feature_id, p_role, s.kind, s.title, s.preconditions, coalesce(s.steps, '{}'), s.expected, 'ai'
  from jsonb_to_recordset(p_scenarios) as s (kind text, title text, preconditions text, steps text[], expected text);
$$;

-- A project's syncs, newest first, each with its features as it left them: what it did to each, and the
-- counts per role (live for the current sync, frozen for older ones). Running and failed syncs have none.
create function public.sync_history(p_project_id uuid)
returns table (
  id uuid,
  status text,
  started_at timestamptz,
  branch text,
  commit_sha text,
  commit_message text,
  commit_author text,
  failure text,
  is_current boolean,
  features jsonb
)
language sql
stable
set search_path = ''
as $$
  with current_sync as (
    select s.id
    from public.syncs s
    where s.project_id = p_project_id and s.status = 'succeeded'
    order by s.started_at desc
    limit 1
  ),
  live as (
    select
      sf.feature_id,
      jsonb_build_object(
        'tester', jsonb_build_object(
          'total', count(sc.id) filter (where sc.role = 'tester'),
          'passed', count(sc.id) filter (where sc.role = 'tester' and sc.verdict = 'passed'),
          'failed', count(sc.id) filter (where sc.role = 'tester' and sc.verdict = 'failed')),
        'developer', jsonb_build_object(
          'total', count(sc.id) filter (where sc.role = 'developer'),
          'passed', count(sc.id) filter (where sc.role = 'developer' and sc.verdict = 'passed'),
          'failed', count(sc.id) filter (where sc.role = 'developer' and sc.verdict = 'failed'))
      ) as counts
    from public.sync_features sf
    left join public.scenarios sc on sc.feature_id = sf.feature_id
    where sf.sync_id = (select cs.id from current_sync cs)
    group by sf.feature_id
  )
  select
    s.id,
    s.status,
    s.started_at,
    s.branch,
    s.commit_sha,
    s.commit_message,
    s.commit_author,
    s.failure,
    s.id is not distinct from (select cs.id from current_sync cs),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', f.id,
            'name', f.name,
            'change', sf.change,
            'scenarios', coalesce(
              case when s.id = (select cs.id from current_sync cs) then live.counts else sf.scenarios end,
              '{"tester": {"total": 0, "passed": 0, "failed": 0}, "developer": {"total": 0, "passed": 0, "failed": 0}}'::jsonb
            )
          )
          order by f.created_at, f.name
        )
        from public.sync_features sf
        join public.features f on f.id = sf.feature_id
        left join live on live.feature_id = sf.feature_id
        where sf.sync_id = s.id
      ),
      '[]'::jsonb
    )
  from public.syncs s
  where s.project_id = p_project_id
  order by s.started_at desc
$$;

revoke execute on function public.claim_sync() from public, anon, authenticated;
revoke execute on function public.start_requested_sync(uuid) from public, anon, authenticated;
revoke execute on function public.request_sync(uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_sync(uuid, int, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_sync(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.replace_ai_scenarios(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_history(uuid) from public, anon, authenticated;
grant execute on function public.claim_sync() to service_role;
grant execute on function public.start_requested_sync(uuid) to service_role;
grant execute on function public.request_sync(uuid, text) to service_role;
grant execute on function public.finish_sync(uuid, int, jsonb) to service_role;
grant execute on function public.fail_sync(uuid, int, text) to service_role;
grant execute on function public.replace_ai_scenarios(uuid, text, jsonb) to service_role;
grant execute on function public.sync_history(uuid) to service_role;
