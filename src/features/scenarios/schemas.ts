import { z } from 'zod'
import { Role } from '../auth/schemas.js'
import { FeatureChange, ProjectRef } from '../projects/schemas.js'

// Names match frontend/src/features/scenarios/types.ts.

export const ScenarioKind = z
  .enum(['happy-path', 'negative', 'validation', 'edge-case', 'security'])
  .meta({ id: 'ScenarioKind' })

export const ScenarioOrigin = z
  .enum(['ai', 'edited', 'manual'])
  .meta({ id: 'ScenarioOrigin', description: 'Who wrote the text: the AI, the AI and then a person, or a person.' })

export const Verdict = z.enum(['passed', 'failed']).meta({ id: 'Verdict' })
export type Verdict = z.infer<typeof Verdict>

export const ScenarioResult = z
  .object({
    verdict: Verdict,
    markedBy: z.object({ id: z.string(), name: z.string() }),
    markedAt: z.string(),
  })
  .meta({ id: 'ScenarioResult', description: "The team's verdict: one per scenario, shared by everyone on the project." })

export const Scenario = z
  .object({
    id: z.uuid(),
    featureId: z.uuid(),
    role: Role,
    kind: ScenarioKind,
    title: z.string(),
    preconditions: z.string().nullable(),
    steps: z.array(z.string()),
    expected: z.string(),
    origin: ScenarioOrigin,
    result: ScenarioResult.nullable().meta({ description: 'Null while nobody has marked it.' }),
  })
  .meta({ id: 'Scenario' })
export type Scenario = z.infer<typeof Scenario>

export const ScenarioInput = z
  .object({
    kind: ScenarioKind,
    title: z.string().trim().min(1, 'Write a title.').max(300, 'Keep the title under 300 characters.'),
    preconditions: z.string().trim().max(2000, 'Keep the preconditions under 2000 characters.').nullable(),
    steps: z
      .array(z.string().trim().max(1000, 'Keep each step under 1000 characters.'))
      .max(50, 'Use at most 50 steps.')
      .meta({ description: 'Empty steps are dropped.' }),
    expected: z.string().trim().min(1, 'Write the expected result.').max(2000, 'Keep it under 2000 characters.'),
  })
  .meta({ id: 'ScenarioInput' })
export type ScenarioInput = z.infer<typeof ScenarioInput>

export const NewScenario = ScenarioInput.extend({ role: Role }).meta({ id: 'NewScenario' })

export const RegenerateInput = z.object({ role: Role }).meta({ id: 'RegenerateInput' })

export const ResultInput = z
  .object({ verdict: Verdict.nullable().meta({ description: 'Null clears the result.' }) })
  .meta({ id: 'ResultInput' })

export const FeatureDetail = z
  .object({
    id: z.uuid(),
    project: ProjectRef,
    name: z.string(),
    description: z.string(),
    change: FeatureChange.nullable().meta({ description: 'The mark as it was. Asking for the feature clears it.' }),
    scenarios: z.array(Scenario).meta({ description: 'Both roles, in the order they were written.' }),
  })
  .meta({ id: 'FeatureDetail' })
export type FeatureDetail = z.infer<typeof FeatureDetail>

export const FeatureParams = z.object({ projectId: z.uuid(), featureId: z.uuid() })
export const FeatureIdParams = z.object({ featureId: z.uuid() })
export const ScenarioParams = z.object({ scenarioId: z.uuid() })
