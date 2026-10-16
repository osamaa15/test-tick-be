import { z } from 'zod'
import { AiError } from '../../lib/ai.js'
import type { Tables } from '../../lib/database.types.js'
import { GitHubError, gitHubGet } from '../../lib/github.js'
import { installationToken } from '../../lib/githubApp.js'
import { logger } from '../../lib/logger.js'
import { supabase } from '../../lib/supabase.js'
import { writeScenarios } from '../scenarios/writer.js'
import { readRepository, SyncFailure } from './code.js'
import { discoverFeatures, planFeatures, type KnownFeature, type PlannedFeature } from './plan.js'

// The sync worker: claims running syncs from the database one at a time, reads the push, has the AI find the
// features and write scenarios for the new and changed ones, and ends the sync with finish_sync.
// shortcut: it runs inside the API process; start it from its own entry point when syncs slow the API down.

const POLL_MS = 5_000
const RENEW_CLAIM_MS = 60_000
const MAX_ATTEMPTS = 3
// Two at a time stays under free tiers' requests-per-minute limits; retries cover the rest.
const WRITERS = 2

type Log = typeof logger

/** Turns a GitHub refusal with one of these statuses into a failure people can read. */
const failOn = (statuses: number[], failure: string) => (err: unknown) => {
  if (err instanceof GitHubError && statuses.includes(err.status)) throw new SyncFailure(failure)
  throw err
}

const HeadCommit = z.object({
  sha: z.string(),
  commit: z.object({ message: z.string(), author: z.object({ name: z.string() }).nullable() }),
  author: z.object({ login: z.string() }).nullable(),
})

/** The features of the project's current sync, and the commit it read. */
async function currentFeatures(projectId: string) {
  const { data, error } = await supabase
    .from('syncs')
    .select('commit_sha, sync_features(feature:features(id, name, description, paths, code_hash))')
    .eq('project_id', projectId)
    .eq('status', 'succeeded')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return { commitSha: data?.commit_sha ?? null, features: (data?.sync_features ?? []).map((row): KnownFeature => row.feature) }
}

/** Calls `work` on every item, at most `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
    }),
  )
}

async function runSync(sync: Tables<'syncs'>, log: Log): Promise<PlannedFeature[]> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('owner, name, provider_repo_id')
    .eq('id', sync.project_id)
    .single()
  if (error) throw error
  const { owner, name } = project

  const token = await installationToken(owner, name, project.provider_repo_id).catch(
    failOn([404], "Testick's GitHub App is not installed on this repository any more."),
  )
  const head = HeadCommit.parse(
    await gitHubGet(`/repos/${owner}/${name}/commits/${encodeURIComponent(sync.branch)}`, token).catch(
      failOn([404, 409, 422], `Testick could not find any commit on the branch ${sync.branch}.`),
    ),
  )
  // Shown on the sync while it runs.
  const commit = {
    commit_sha: head.sha,
    commit_message: (head.commit.message.split('\n')[0] ?? '').slice(0, 500),
    commit_author: head.commit.author?.name ?? head.author?.login ?? 'Unknown',
  }
  await supabase.from('syncs').update(commit).eq('id', sync.id).eq('attempts', sync.attempts)

  const current = await currentFeatures(sync.project_id)
  // Nothing new to read: the features stay as they are.
  if (current.commitSha === head.sha) return current.features.map((feature) => ({ ...feature, change: null, scenarios: [] }))

  const files = await readRepository(token, owner, name, head.sha)
  log.info({ files: files.size }, 'read the repository')
  const planned = planFeatures(current.features, await discoverFeatures(files, current.features), files)

  const toWrite = planned.filter((feature) => feature.change !== null)
  log.info({ features: planned.length, writing: toWrite.length }, 'found the features')
  await inBatches(toWrite, WRITERS, async (feature) => {
    const code = feature.paths.flatMap((path): [string, string][] => [[path, files.get(path) ?? '']])
    feature.scenarios = await writeScenarios(feature, code, ['tester', 'developer'])
  })
  return planned
}

/** Claims the next running sync and runs it to the end. False when there was none. */
async function runNextSync(): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_sync')
  if (error) throw error
  const sync = data[0]
  if (!sync) return false

  const log = logger.child({ syncId: sync.id })
  // Renewing the claim tells other workers this sync is still being worked on.
  const renew = setInterval(() => {
    void supabase
      .from('syncs')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', sync.id)
      .eq('attempts', sync.attempts)
      .then(({ error: renewError }) => renewError && log.warn({ err: renewError }, 'could not renew the claim'))
  }, RENEW_CLAIM_MS)

  try {
    if (sync.attempts > MAX_ATTEMPTS) throw new SyncFailure('Testick could not finish this sync after several tries.')
    const features = await runSync(sync, log)
    const finished = await supabase.rpc('finish_sync', { p_sync_id: sync.id, p_attempt: sync.attempts, p_features: features })
    if (finished.error) throw finished.error
    log.info({ features: features.length, finished: finished.data }, 'sync succeeded')
  } catch (err) {
    if (!(err instanceof SyncFailure)) log.error({ err }, 'sync failed')
    const failure =
      err instanceof SyncFailure
        ? err.message
        : err instanceof AiError
          ? 'The AI could not read this push. The next push will try again.'
          : 'Something went wrong while syncing. The next push will try again.'
    const failed = await supabase.rpc('fail_sync', { p_sync_id: sync.id, p_attempt: sync.attempts, p_failure: failure })
    if (failed.error) log.error({ err: failed.error }, 'could not record the failure')
  } finally {
    clearInterval(renew)
  }
  return true
}

let wake: (() => void) | undefined

/** Starts the next sync now instead of at the next poll, as after a push. */
export const wakeSyncWorker = () => wake?.()

/** Runs syncs until the returned function is called. Each process runs one sync at a time. */
export function startSyncWorker() {
  let running = true
  void (async () => {
    while (running) {
      let worked = false
      try {
        worked = await runNextSync()
      } catch (err) {
        logger.error({ err }, 'the sync worker could not claim a sync')
      }
      if (!worked && running) {
        await new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, POLL_MS).unref()
        })
      }
    }
  })()
  return () => {
    running = false
    wake?.()
  }
}
