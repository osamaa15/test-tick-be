import type { Tables, TablesUpdate } from '../../lib/database.types.js'
import { HttpError } from '../../lib/errors.js'
import { installationToken, readFiles } from '../../lib/githubApp.js'
import { supabase } from '../../lib/supabase.js'
import { Role } from '../auth/schemas.js'
import { accessibleRepositories } from '../projects/repositories.js'
import { FeatureChange } from '../projects/schemas.js'
import {
  ScenarioKind,
  ScenarioOrigin,
  Verdict,
  type FeatureDetail,
  type Scenario,
  type ScenarioInput,
} from './schemas.js'
import { writeScenarios } from './writer.js'

const SCENARIO = '*, marker:users!marked_by(id, name)'
type ScenarioRow = Tables<'scenarios'> & { marker: { id: string; name: string } | null }

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

/** Changes the text. An AI scenario becomes `edited`; the result stays. */
export async function editScenario(userId: string, scenarioId: string, input: ScenarioInput): Promise<Scenario> {
  const { origin } = await findScenario(userId, scenarioId)
  return saveScenario(scenarioId, { ...cleanInput(input), origin: origin === 'ai' ? 'edited' : origin })
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
  const written = await writeScenarios(feature, files, [role], kept.data.map((scenario) => scenario.title))

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
