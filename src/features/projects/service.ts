import type { Database } from '../../lib/database.types.js'
import { HttpError } from '../../lib/errors.js'
import { supabase } from '../../lib/supabase.js'
import { accessibleRepositories, repositoryOfProject, type AccessibleRepository } from './repositories.js'
import { FeatureChange, SyncStatus, type Project, type ProjectDetail, type Repository } from './schemas.js'

type Functions = Database['public']['Functions']
type ProjectRow = Functions['project_summaries']['Returns'][number]
type Counts = Pick<
  ProjectRow,
  'tester_total' | 'tester_passed' | 'tester_failed' | 'developer_total' | 'developer_passed' | 'developer_failed'
>

const countsOf = (row: Counts): Project['scenarios'] => ({
  tester: { total: row.tester_total, passed: row.tester_passed, failed: row.tester_failed },
  developer: { total: row.developer_total, passed: row.developer_passed, failed: row.developer_failed },
})

/** The connected projects among these repositories, most recently synced first, as the person sees them. */
async function projectsFor(userId: string, repositories: Map<string, AccessibleRepository>, repoIds: string[]) {
  const { data, error } = await supabase.rpc('project_summaries', { p_user_id: userId, p_repo_ids: repoIds })
  if (error) throw error
  return data.flatMap((row): Project[] => {
    const repository = repositories.get(row.provider_repo_id)
    if (!repository) return []
    const { id, provider, owner, name, visibility, defaultBranch, isLead } = repository
    return [
      {
        id: row.id,
        // The provider's names, not the ones stored when it was connected: they stay right after a rename.
        repository: { id, provider, owner, name, visibility, defaultBranch },
        featureCount: row.feature_count,
        newFeatureCount: row.new_feature_count,
        scenarios: countsOf(row),
        latestSync: {
          status: SyncStatus.parse(row.latest_status),
          startedAt: row.latest_started_at,
          commit: row.latest_commit_sha ? row.latest_commit_sha.slice(0, 7) : null,
        },
        isLead,
      },
    ]
  })
}

/** Every project whose repository the person can access, whoever connected it. */
export async function listProjects(userId: string): Promise<Project[]> {
  const repositories = await accessibleRepositories(userId)
  return projectsFor(userId, repositories, [...repositories.keys()])
}

/** One project with its features, or 404 when it does not exist or the person cannot access its repository. */
export async function getProject(userId: string, projectId: string): Promise<ProjectDetail> {
  const repository = await repositoryOfProject(userId, projectId)
  const [[project], features] = await Promise.all([
    projectsFor(userId, new Map([[repository.id, repository]]), [repository.id]),
    supabase.rpc('feature_summaries', { p_user_id: userId, p_project_ids: [projectId] }),
  ])
  if (!project) throw new HttpError(404, 'Not found.')
  if (features.error) throw features.error
  return {
    ...project,
    features: features.data.map((feature) => ({
      id: feature.id,
      name: feature.name,
      description: feature.description,
      change: FeatureChange.nullable().parse(feature.change),
      scenarios: countsOf(feature),
    })),
  }
}

/** Every repository the person can access, most recently pushed first, read from GitHub now. */
export async function listRepositories(userId: string): Promise<Repository[]> {
  const repositories = await accessibleRepositories(userId, { fresh: true })
  const projects = await projectsFor(userId, repositories, [...repositories.keys()])
  const projectIds = new Map(projects.map((project) => [project.repository.id, project.id]))
  return [...repositories.values()]
    .map(({ isLead: _isLead, ...repository }) => ({ ...repository, projectId: projectIds.get(repository.id) ?? null }))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
}

/**
 * Connects repositories as projects, each starting its first sync, and returns them in the order asked.
 * One already connected is returned as it is. One the person cannot access is a 404, and nothing is written.
 */
export async function connectRepositories(userId: string, repositoryIds: string[]): Promise<Project[]> {
  const ids = [...new Set(repositoryIds)]
  const repositories = await accessibleRepositories(userId)
  const chosen = ids.flatMap((id) => repositories.get(id) ?? [])
  if (chosen.length !== ids.length) throw new HttpError(404, 'Not found.')

  const { error } = await supabase.rpc('connect_projects', {
    p_user_id: userId,
    p_repos: chosen.map((repo) => ({
      provider_repo_id: repo.id,
      owner: repo.owner,
      name: repo.name,
      visibility: repo.visibility,
      default_branch: repo.defaultBranch,
    })),
  })
  if (error) throw error

  const projects = await projectsFor(userId, repositories, ids)
  return ids.flatMap((id) => projects.find((project) => project.repository.id === id) ?? [])
}

/**
 * Removes a project from Testick, with everything Testick stored for it: syncs, features, scenarios and results.
 * The repository on GitHub is untouched. Only a Lead may, because it ends the project for the whole team.
 */
export async function removeProject(userId: string, projectId: string) {
  const repository = await repositoryOfProject(userId, projectId)
  if (!repository.isLead) throw new HttpError(403, 'Only a Lead of this repository (admin or maintain access) can remove it.')
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw error
}
