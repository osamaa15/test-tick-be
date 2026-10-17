import type { Tables, TablesUpdate } from '../../lib/database.types.js'
import { AiLimitError } from '../../lib/ai.js'
import { HttpError } from '../../lib/errors.js'
import { installationToken, readFiles } from '../../lib/githubApp.js'
import { supabase } from '../../lib/supabase.js'
import { Role } from '../auth/schemas.js'
import { accessibleRepositories, repositoryOfProject } from '../projects/repositories.js'
import { FeatureChange } from '../projects/schemas.js'
import {
  ScenarioKind,
  ScenarioOrigin,
  Verdict,
  type Board,
  type BoardStatus,
  type FeatureDetail,
  type Scenario,
  type ScenarioInput,
} from './schemas.js'
import { writeScenarios } from './writer.js'

const SCENARIO = '*, marker:users!marked_by(id, name), assignee:users!assigned_to(id, name, avatar_url)'
type ScenarioRow = Tables<'scenarios'> & {
  marker: { id: string; name: string } | null
  assignee: { id: string; name: string; avatar_url: string | null } | null
}

export const toScenario = (row: ScenarioRow): Scenario => ({
  id: row.id,
  featureId: row.feature_id,
  role: Role.parse(row.role),
  kind: ScenarioKind.parse(row.kind),
  title: row.title,
  preconditions: row.preconditions,
  steps: row.steps,
  expected: row.expected,
  origin: ScenarioOrigin.parse(row.origin),
  result:
    row.verdict && row.marked_at
      ? {
          verdict: Verdict.parse(row.verdict),
          // The person who marked it may have deleted their account since.
          markedBy: row.marker ?? { id: '', name: 'A former teammate' },
          markedAt: row.marked_at,
        }
      : null,
  assignee: row.assignee && { id: row.assignee.id, name: row.assignee.name, avatarUrl: row.assignee.avatar_url },
})

/** What a person typed, tidied: blank preconditions become null and empty steps go. The schema already trimmed it. */
export const cleanInput = ({ kind, title, preconditions, steps, expected }: ScenarioInput): ScenarioInput => ({
  kind,
  title,
  preconditions: preconditions || null,
  steps: steps.filter(Boolean),
  expected,
})

const notFound = () => new HttpError(404, 'Not found.')

/** A feature and its repository as the person sees it. 404 when it does not exist or is not theirs to see. */
async function findFeature(userId: string, featureId: string) {
  const [{ data: feature, error }, repositories] = await Promise.all([
    supabase
      .from('features')
      .select('id, name, description, paths, project_id, project:projects!inner(provider_repo_id)')
      .eq('id', featureId)
      .maybeSingle(),
    accessibleRepositories(userId),
  ])
  if (error) throw error
  const repository = feature && repositories.get(feature.project.provider_repo_id)
  if (!feature || !repository) throw notFound()
  return { feature, repository }
}

/** A scenario's origin, after the same check as `findFeature`. */
async function findScenario(userId: string, scenarioId: string) {
  const [{ data: scenario, error }, repositories] = await Promise.all([
    supabase
      .from('scenarios')
      .select('origin, feature:features!inner(project:projects!inner(provider_repo_id))')
      .eq('id', scenarioId)
      .maybeSingle(),
    accessibleRepositories(userId),
  ])
  if (error) throw error
  if (!scenario || !repositories.has(scenario.feature.project.provider_repo_id)) throw notFound()
  return scenario
}

async function saveScenario(scenarioId: string, changes: TablesUpdate<'scenarios'>) {
  const { data, error } = await supabase.from('scenarios').update(changes).eq('id', scenarioId).select(SCENARIO).maybeSingle()
  if (error) throw error
  // A sync replaced it between the check and the write.
  if (!data) throw notFound()
  return toScenario(data)
}

/** The feature page: the feature with both roles' scenarios. Opening it clears its New or Changed mark for the person. */
export async function getFeature(userId: string, projectId: string, featureId: string): Promise<FeatureDetail> {
  const { feature, repository } = await findFeature(userId, featureId)
  if (feature.project_id !== projectId) throw notFound()

  const [mark, scenarios] = await Promise.all([
    supabase.rpc('open_feature', { p_user_id: userId, p_feature_id: featureId }),
    supabase.from('scenarios').select(SCENARIO).eq('feature_id', featureId).order('seq'),
  ])
  if (mark.error) throw mark.error
  if (scenarios.error) throw scenarios.error
  return {
    id: feature.id,
    project: { id: projectId, name: repository.name, isLead: repository.isLead },
    name: feature.name,
    description: feature.description,
    change: FeatureChange.nullable().parse(mark.data),
    scenarios: scenarios.data.map(toScenario),
  }
}

/** Marks the team's result, recording who and when. `null` clears it. */
export async function setResult(userId: string, scenarioId: string, verdict: Verdict | null): Promise<Scenario> {
  await findScenario(userId, scenarioId)
  return saveScenario(
    scenarioId,
    verdict
      ? { verdict, marked_by: userId, marked_at: new Date().toISOString() }
      : { verdict: null, marked_by: null, marked_at: null },
  )
}

/**
 * What moving a scenario on the board changes. Passed and failed are its result, and keep who took it. In progress
 * takes it for the person and clears the result. To do frees it and clears the result.
 */
export function statusChanges(status: BoardStatus, userId: string, now: string): TablesUpdate<'scenarios'> {
  const unmarked = { verdict: null, marked_by: null, marked_at: null }
  if (status === 'to-do') return { ...unmarked, assigned_to: null, assigned_at: null }
  if (status === 'in-progress') return { ...unmarked, assigned_to: userId, assigned_at: now }
  return { verdict: status, marked_by: userId, marked_at: now }
}

/** Moves a scenario on the board, for the whole team. */
export async function moveScenario(userId: string, scenarioId: string, status: BoardStatus): Promise<Scenario> {
  await findScenario(userId, scenarioId)
  return saveScenario(scenarioId, statusChanges(status, userId, new Date().toISOString()))
}

/**
 * The board: every scenario of the project's current features (those of its newest sync that finished, as on the
 * project page), both roles, and those features by name.
 */
export async function getBoard(userId: string, projectId: string): Promise<Board> {
  const repository = await repositoryOfProject(userId, projectId)
  const { data: sync, error } = await supabase
    .from('syncs')
    .select('sync_features(feature:features(id, name))')
    .eq('project_id', projectId)
    .eq('status', 'succeeded')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const features = (sync?.sync_features ?? []).map((row) => row.feature).sort((a, b) => a.name.localeCompare(b.name))
  const scenarios = await supabase
    .from('scenarios')
    .select(SCENARIO)
    .in(
      'feature_id',
      features.map((feature) => feature.id),
    )
    .order('seq')
  if (scenarios.error) throw scenarios.error
  return {
    project: { id: projectId, name: repository.name, isLead: repository.isLead },
    features,
    scenarios: scenarios.data.map(toScenario),
  }
}

/** Changes the text. An AI scenario becomes `edited`; the result stays. */
export async function editScenario(userId: string, scenarioId: string, input: ScenarioInput): Promise<Scenario> {
  const { origin } = await findScenario(userId, scenarioId)
  return saveScenario(scenarioId, { ...cleanInput(input), origin: origin === 'ai' ? 'edited' : origin })
}

/** Deletes a scenario for the whole team, with its result, whatever wrote it. */
export async function deleteScenario(userId: string, scenarioId: string) {
  await findScenario(userId, scenarioId)
  const { error } = await supabase.from('scenarios').delete().eq('id', scenarioId)
  if (error) throw error
}

/**
 * Has the AI rewrite one role's AI scenarios from the feature's code at the current sync, and returns that role's
 * scenarios afterwards. Edited and hand-written ones stay as they are, with their results.
 */
export async function regenerateScenarios(userId: string, featureId: string, role: Role): Promise<Scenario[]> {
  const { feature, repository } = await findFeature(userId, featureId)
  const [current, kept] = await Promise.all([
    supabase
      .from('syncs')
      .select('commit_sha')
      .eq('project_id', feature.project_id)
      .eq('status', 'succeeded')
      .order('started_at', { ascending: false })
      .limit(1)
      .single(),
    supabase.from('scenarios').select('title').eq('feature_id', featureId).eq('role', role).neq('origin', 'ai'),
  ])
  if (current.error) throw current.error
  if (kept.error) throw kept.error

  const { owner, name, id } = repository
  const token = await installationToken(owner, name, id)
  const files = current.data.commit_sha ? await readFiles(token, owner, name, current.data.commit_sha, feature.paths) : []
  const existing = kept.data.map((scenario) => scenario.title)
  const [written = []] = await writeScenarios([{ name: feature.name, description: feature.description, files, existing }], [role]).catch((err: unknown) => {
    throw err instanceof AiLimitError ? new HttpError(429, 'The AI has used up its requests for today. Try again tomorrow.') : err
  })

  const replaced = await supabase.rpc('replace_ai_scenarios', {
    p_feature_id: featureId,
    p_role: role,
    p_scenarios: written.map(({ role: _role, ...scenario }) => scenario),
  })
  if (replaced.error) throw replaced.error
  const { data, error } = await supabase.from('scenarios').select(SCENARIO).eq('feature_id', featureId).eq('role', role).order('seq')
  if (error) throw error
  return data.map(toScenario)
}

/** Adds a person's own scenario to one role's view of a feature. */
export async function addScenario(
  userId: string,
  featureId: string,
  role: Role,
  input: ScenarioInput,
): Promise<Scenario> {
  await findFeature(userId, featureId)
  const { data, error } = await supabase
    .from('scenarios')
    .insert({ feature_id: featureId, role, ...cleanInput(input), origin: 'manual' })
    .select(SCENARIO)
    .single()
  if (error) throw error
  return toScenario(data)
}
