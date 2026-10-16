import { z } from 'zod'
import { FeatureChange, ProjectRef, ScenariosByRole, SyncStatus } from '../projects/schemas.js'

// Names match frontend/src/features/syncs/types.ts.

export const Commit = z
  .object({
    hash: z.string().meta({ description: 'Short hash.' }),
    message: z.string().meta({ description: 'The first line of its message.' }),
    author: z.string().meta({ description: 'Who wrote it, as the provider names them.' }),
  })
  .meta({ id: 'Commit' })

export const SyncFeature = z
  .object({
    id: z.uuid(),
    name: z.string(),
    change: FeatureChange.nullable().meta({ description: 'What this sync did to it, or null when it did not touch it.' }),
    scenarios: ScenariosByRole,
  })
  .meta({ id: 'SyncFeature' })

export const Sync = z
  .object({
    id: z.uuid(),
    status: SyncStatus,
    startedAt: z.string(),
    branch: z.string(),
    commit: Commit.nullable().meta({ description: 'Null while not known yet.' }),
    failure: z.string().nullable().meta({ description: 'Why it did not finish, for people. Set only when it failed.' }),
    current: z.boolean().meta({ description: 'True for the newest sync that finished. Its counts are live.' }),
    features: z.array(SyncFeature).meta({ description: 'Empty while it runs, and when it failed.' }),
    scenarios: ScenariosByRole,
  })
  .meta({ id: 'Sync' })
export type Sync = z.infer<typeof Sync>

export const SyncHistory = z.object({ project: ProjectRef, syncs: z.array(Sync) }).meta({ id: 'SyncHistory' })
export type SyncHistory = z.infer<typeof SyncHistory>

export const ProjectParams = z.object({ projectId: z.uuid() })
