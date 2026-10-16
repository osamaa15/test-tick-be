import { z } from 'zod'
import { HttpError } from '../../lib/errors.js'
import { gitHubGet } from '../../lib/github.js'
import { supabase } from '../../lib/supabase.js'
import { asGitHubUser } from '../auth/tokens.js'
import type { Repository } from './schemas.js'

const GitHubRepository = z.object({
  id: z.number(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  description: z.string().nullable(),
  private: z.boolean(),
  default_branch: z.string(),
  pushed_at: z.string().nullable(),
  created_at: z.string(),
  // With a person's token, GitHub says what that person may do in the repository.
  permissions: z.object({ admin: z.boolean(), maintain: z.boolean().optional() }).optional(),
})

/** A repository the person can access, and whether they are a Lead on it. */
export type AccessibleRepository = Omit<Repository, 'projectId'> & { isLead: boolean }

export const toRepository = (repo: z.infer<typeof GitHubRepository>): AccessibleRepository => ({
  id: String(repo.id),
  provider: 'github',
  owner: repo.owner.login,
  name: repo.name,
  description: repo.description,
  // An internal repository is seen only inside its organisation, so it counts as private.
  visibility: repo.private ? 'private' : 'public',
  defaultBranch: repo.default_branch,
  // An empty repository has never been pushed to.
  pushedAt: repo.pushed_at ?? repo.created_at,
  isLead: Boolean(repo.permissions?.admin || repo.permissions?.maintain),
})

const Installations = z.object({ installations: z.array(z.object({ id: z.number() })) })
const Repositories = z.object({ repositories: z.array(GitHubRepository) })

/**
 * Every item of a paged GitHub list.
 * shortcut: pages are read one after another, slow past a few thousand repositories; read the rest in
 * parallel from `total_count` when someone has that many.
 */
async function everyPage<T>(path: string, token: string, itemsOf: (body: unknown) => T[]): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const batch = itemsOf(await gitHubGet(`${path}?per_page=100&page=${page}`, token))
    items.push(...batch)
    if (batch.length < 100) return items
  }
}

/** Every repository the person can access that Testick's GitHub App is installed on, by id. */
async function readRepositories(token: string) {
  const installations = await everyPage('/user/installations', token, (body) => Installations.parse(body).installations)
  const lists = await Promise.all(
    installations.map(({ id }) =>
      everyPage(`/user/installations/${id}/repositories`, token, (body) => Repositories.parse(body).repositories),
    ),
  )
  return new Map(lists.flat().map((repo) => [String(repo.id), toRepository(repo)]))
}

// The projects pages poll every 3 seconds while a sync runs; this keeps that to one GitHub read a minute per person.
// shortcut: kept in this process's memory, so each instance reads on its own; share it (Redis) with the rate limits.
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; repositories: Promise<Map<string, AccessibleRepository>> }>()

/**
 * The repositories the person can access, by id: who may see a project and who leads it. An answer up to a
 * minute old is reused, unless `fresh` (the connect page, where people come after changing access on GitHub).
 */
export function accessibleRepositories(userId: string, { fresh = false } = {}) {
  const now = Date.now()
  const cached = cache.get(userId)
  if (cached && !fresh && now - cached.at < CACHE_MS) return cached.repositories

  for (const [key, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(key)
  const repositories = asGitHubUser(userId, readRepositories)
  cache.set(userId, { at: now, repositories })
  // A failure is not kept: the next request asks GitHub again.
  repositories.catch(() => {
    if (cache.get(userId)?.repositories === repositories) cache.delete(userId)
  })
  return repositories
}

/** The repository of a project the person can access, or a 404: the same answer as for a project that does not exist. */
export async function repositoryOfProject(userId: string, projectId: string): Promise<AccessibleRepository> {
  const [{ data: project, error }, repositories] = await Promise.all([
    supabase.from('projects').select('provider_repo_id').eq('id', projectId).maybeSingle(),
    accessibleRepositories(userId),
  ])
  if (error) throw error
  const repository = project && repositories.get(project.provider_repo_id)
  if (!repository) throw new HttpError(404, 'Not found.')
  return repository
}
