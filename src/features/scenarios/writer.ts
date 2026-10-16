import { z } from 'zod'
import { askAi } from '../../lib/ai.js'
import { Role } from '../auth/schemas.js'
import { ScenarioKind, type ScenarioInput } from './schemas.js'

// Writing features' scenarios with the AI: several features per request in a sync (both roles), one when
// regenerating (one role). Free tiers count requests per day, so fewer, bigger requests go further.

const Written = z.object({
  features: z.array(
    z.object({
      feature: z.number().int().describe('The number of the feature, as given.'),
      scenarios: z.array(
        z.object({
          role: Role,
          kind: ScenarioKind,
          title: z.string().describe('What to do, in a few words. At most 300 characters.'),
          preconditions: z.string().nullable().describe('What must be true before starting, or null.'),
          steps: z.array(z.string()).describe('Short steps in order. Empty when the title already says what to do.'),
          expected: z.string().describe('What should happen.'),
        }),
      ),
    }),
  ),
})

const SYSTEM = `You write test case scenarios for Testick, in plain English, for features of a software product.
- A scenario says what to do and what should happen. Never write test code, automation, commands or code blocks.
- Tester scenarios follow what a person does in the product: what to open, type and click, and what they should see. Avoid code words.
- Developer scenarios cover how the feature behaves underneath: inputs, validation, errors, edge cases, permissions and security, still in plain sentences.
- Use the kinds that fit: happy-path, negative, validation, edge-case, security. Write 4 to 8 scenarios for each role asked for, for every feature given.
- Base every scenario on that feature's code; never invent behaviour it does not have.
- Do not repeat a scenario that already exists.`

// About 75k tokens of code per request, shared by its features.
const CODE_BUDGET = 300_000

export type WrittenScenario = ScenarioInput & { role: Role }

/** A feature to write for: its files, and the titles of scenarios that stay and must not be repeated. */
export type FeatureToWrite = { name: string; description: string; files: [path: string, text: string][]; existing?: string[] }

/** The scenarios for these roles of each feature, in the order the features were given. */
export async function writeScenarios(features: FeatureToWrite[], roles: Role[]): Promise<WrittenScenario[][]> {
  const budget = Math.floor(CODE_BUDGET / features.length)
  const described = features.map((feature, index) => {
    let room = budget
    const code = feature.files.flatMap(([path, text]) => {
      if (room <= 0) return []
      const part = text.slice(0, room)
      room -= part.length
      return [`<file path="${path}">\n${part}\n</file>`]
    })
    return [
      `## Feature ${index + 1}: ${feature.name}\nWhat it does: ${feature.description}`,
      feature.existing?.length ? `These scenarios exist and stay:\n${feature.existing.map((title) => `- ${title}`).join('\n')}` : '',
      code.length ? `Its code:\n\n${code.join('\n\n')}` : 'Its code could not be read; write from the description.',
    ]
      .filter(Boolean)
      .join('\n\n')
  })
  const prompt = `Write scenarios for: ${roles.join(' and ')}, for each of these ${features.length} features.\n\n${described.join('\n\n')}`
  const answer = await askAi({ system: SYSTEM, prompt, schema: Written })

  // The same limits the database keeps. A scenario with no title or expected result is dropped.
  const written = features.map((): WrittenScenario[] => [])
  for (const { feature, scenarios } of answer.features) {
    const list = written[feature - 1]
    if (!list) continue
    for (const scenario of scenarios) {
      const title = scenario.title.trim().slice(0, 300)
      const expected = scenario.expected.trim().slice(0, 2000)
      if (!roles.includes(scenario.role) || !title || !expected) continue
      list.push({
        role: scenario.role,
        kind: scenario.kind,
        title,
        preconditions: scenario.preconditions?.trim().slice(0, 2000) || null,
        steps: scenario.steps.map((step) => step.trim().slice(0, 1000)).filter(Boolean).slice(0, 50),
        expected,
      })
    }
  }
  return written
}
