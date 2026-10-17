import { z } from 'zod'
import { supabase } from '../../lib/supabase.js'
import { repositoryOfProject } from '../projects/repositories.js'
import { SyncStatus } from '../projects/schemas.js'
import { SyncFeature, type Sync, type SyncHistory } from './schemas.js'

const SyncFeatures = z.array(SyncFeature)

/** Sync now: a sync of the project's default branch at its latest commit, as a push starts. One running is followed by another. */
export async function syncNow(userId: string, projectId: string) {
  const repository = await repositoryOfProject(userId, projectId)
  const { error } = await supabase.rpc('request_sync', { p_project_id: projectId, p_branch: repository.defaultBranch })
  if (error) throw error
}

/** A project's syncs, newest first, each with its features and counts as it left them. */
export async function getSyncHistory(userId: string, projectId: string): Promise<SyncHistory> {
  const repository = await repositoryOfProject(userId, projectId)
  const { data, error } = await supabase.rpc('sync_history', { p_project_id: projectId })
  if (error) throw error
  return {
    project: { id: projectId, name: repository.name, isLead: repository.isLead },
    syncs: data.map((row): Sync => {
      const features = SyncFeatures.parse(row.features)
      const total = (role: 'tester' | 'developer') => ({
        total: features.reduce((sum, feature) => sum + feature.scenarios[role].total, 0),
        passed: features.reduce((sum, feature) => sum + feature.scenarios[role].passed, 0),
        failed: features.reduce((sum, feature) => sum + feature.scenarios[role].failed, 0),
      })
      return {
        id: row.id,
        status: SyncStatus.parse(row.status),
        startedAt: row.started_at,
        branch: row.branch,
        commit: row.commit_sha
          ? { hash: row.commit_sha.slice(0, 7), message: row.commit_message ?? '', author: row.commit_author ?? '' }
          : null,
        failure: row.failure || null,
        current: row.is_current,
        features,
        scenarios: { tester: total('tester'), developer: total('developer') },
      }
    }),
  }
}

/** A push to a connected repository's default branch. False when the repository is not a project. */
export async function requestSync(repoId: string, branch: string): Promise<boolean> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('id')
    .eq('provider', 'github')
    .eq('provider_repo_id', repoId)
    .maybeSingle()
  if (error) throw error
  if (!project) return false
  const requested = await supabase.rpc('request_sync', { p_project_id: project.id, p_branch: branch })
  if (requested.error) throw requested.error
  return true
}
