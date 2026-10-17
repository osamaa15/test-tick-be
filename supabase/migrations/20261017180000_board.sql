-- The board (GET /api/projects/:projectId/board, PUT /api/scenarios/:scenarioId/status): who took a scenario to test
-- it. A scenario someone took that nobody has marked yet is In progress. Deleting the person frees it.
alter table public.scenarios
  add column assigned_to uuid references public.users on delete set null,
  add column assigned_at timestamptz;

create index scenarios_assigned_to_idx on public.scenarios (assigned_to);
