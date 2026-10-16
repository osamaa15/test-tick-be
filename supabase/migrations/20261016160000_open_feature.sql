-- Scenarios (step 5): GET /api/projects/:projectId/features/:featureId clears the feature's New or Changed
-- mark for the person opening it. Reading the mark and clearing it happen together, in one round trip.

-- Returns the mark as it was (added, changed or null), and records that this person has seen the feature as
-- of its project's current sync. Before the first sync has finished there is nothing to clear.
create function public.open_feature(p_user_id uuid, p_feature_id uuid)
returns text
language sql
volatile
set search_path = ''
as $$
  with current_sync as (
    select s.id
    from public.syncs s
    join public.features f on f.project_id = s.project_id
    where f.id = p_feature_id and s.status = 'succeeded'
    order by s.started_at desc
    limit 1
  ),
  mark as (
    select cs.id as sync_id, case when v.sync_id is distinct from cs.id then sf.change end as change
    from current_sync cs
    left join public.sync_features sf on sf.sync_id = cs.id and sf.feature_id = p_feature_id
    left join public.feature_views v on v.user_id = p_user_id and v.feature_id = p_feature_id
  ),
  seen as (
    insert into public.feature_views (user_id, feature_id, sync_id)
    select p_user_id, p_feature_id, mark.sync_id from mark
    on conflict (user_id, feature_id) do update set sync_id = excluded.sync_id
  )
  select mark.change from mark
$$;

revoke execute on function public.open_feature(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_feature(uuid, uuid) to service_role;
