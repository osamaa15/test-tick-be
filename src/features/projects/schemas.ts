import { z } from 'zod'
import { Provider } from '../auth/schemas.js'

// Names match frontend/src/features/projects/types.ts.

export const RepositoryVisibility = z.enum(['public', 'private']).meta({ id: 'RepositoryVisibility' })

export const Repository = z
  .object({
    id: z.string(),
    provider: Provider,
    owner: z.string().meta({ description: 'The account or organisation that owns it.' }),
    name: z.string(),
    description: z.string().nullable(),
    visibility: RepositoryVisibility,
    defaultBranch: z.string(),
    pushedAt: z.string().meta({ description: 'When code was last pushed (ISO date).' }),
    projectId: z.uuid().nullable().meta({ description: 'The project it is connected as, or null.' }),
  })
  .meta({ id: 'Repository' })
export type Repository = z.infer<typeof Repository>

export const SyncStatus = z.enum(['running', 'succeeded', 'failed']).meta({ id: 'SyncStatus' })

export const SyncSummary = z
  .object({
    status: SyncStatus,
    startedAt: z.string(),
    commit: z.string().nullable().meta({ description: 'Short hash of the commit it read, or null while not known.' }),
  })
  .meta({ id: 'SyncSummary' })

export const ScenarioSummary = z
  .object({ total: z.number().int(), passed: z.number().int(), failed: z.number().int() })
  .meta({ id: 'ScenarioSummary' })

const ScenariosByRole = z
  .object({ tester: ScenarioSummary, developer: ScenarioSummary })
  .meta({ description: "Counts per role, because each role sees its own scenarios. Results are the team's." })

export const Project = z
  .object({
    id: z.uuid(),
    repository: Repository.pick({ id: true, provider: true, owner: true, name: true, visibility: true, defaultBranch: true }),
    featureCount: z.number().int().meta({ description: '0 until the first sync has finished.' }),
    newFeatureCount: z
      .number()
      .int()
      .meta({ description: 'Features the latest sync added or changed that the person has not opened yet.' }),
    scenarios: ScenariosByRole,
    latestSync: SyncSummary,
    isLead: z.boolean().meta({ description: 'The person has admin or maintain access to the repository.' }),
  })
  .meta({ id: 'Project' })
export type Project = z.infer<typeof Project>

export const ProjectRef = z
  .object({ id: z.uuid(), name: z.string(), isLead: z.boolean() })
  .meta({ id: 'ProjectRef', description: 'What pages about one project carry: its name, and whether the person leads it.' })

export const FeatureChange = z.enum(['added', 'changed']).meta({ id: 'FeatureChange' })

export const FeatureSummary = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    change: FeatureChange.nullable().meta({ description: 'Set while the feature has something the person has not opened.' }),
    scenarios: ScenariosByRole,
  })
  .meta({ id: 'FeatureSummary' })

export const ProjectDetail = Project.extend({ features: z.array(FeatureSummary) }).meta({ id: 'ProjectDetail' })
export type ProjectDetail = z.infer<typeof ProjectDetail>

export const ConnectInput = z
  .object({
    repositoryIds: z
      .array(z.string().trim().min(1).max(30))
      .min(1, 'Choose at least one repository.')
      .max(100, 'Connect at most 100 repositories at a time.'),
  })
  .meta({ id: 'ConnectInput' })

export const ProjectParams = z.object({ projectId: z.uuid() })
