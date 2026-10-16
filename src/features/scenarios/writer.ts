import { z } from 'zod'
import { askClaude } from '../../lib/ai.js'
import { Role } from '../auth/schemas.js'
import { ScenarioKind, type ScenarioInput } from './schemas.js'

// Writing a feature's scenarios with Claude: for a sync (both roles) and for regenerating (one role).

const Written = z.object({
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
})

const SYSTEM = `You write test case scenarios for Testick, in plain English, for one feature of a software product.
- A scenario says what to do and what should happen. Never write test code, automation, commands or code blocks.
- Tester scenarios follow what a person does in the product: what to open, type and click, and what they should see. Avoid code words.
- Developer scenarios cover how the feature behaves underneath: inputs, validation, errors, edge cases, permissions and security, still in plain sentences.
- Use the kinds that fit: happy-path, negative, validation, edge-case, security. Write 4 to 8 scenarios for each role asked for.
- Base every scenario on the code you are given; never invent behaviour it does not have.
- Do not repeat a scenario that already exists.`

// About 40k tokens of code is plenty for one feature, and keeps each call quick and cheap.
const CODE_BUDGET = 150_000

export type WrittenScenario = ScenarioInput & { role: Role }

/** Scenarios for these roles, from the feature's files. `existing` are titles that stay and must not be repeated. */
export async function writeScenarios(
  feature: { name: string; description: string },
  files: [path: string, text: string][],
  roles: Role[],
  existing: string[] = [],
): Promise<WrittenScenario[]> {
  let room = CODE_BUDGET
  const code = files.flatMap(([path, text]) => {
    if (room <= 0) return []
    const part = text.slice(0, room)
    room -= part.length
    return [`<file path="${path}">\n${part}\n</file>`]
  })
  const prompt = [
    `Feature: ${feature.name}\nWhat it does: ${feature.description}`,
    `Write scenarios for: ${roles.join(' and ')}.`,
    existing.length ? `These scenarios exist and stay:\n${existing.map((title) => `- ${title}`).join('\n')}` : '',
    code.length ? `The feature's code:\n\n${code.join('\n\n')}` : 'Its code could not be read; write from the description.',
  ]
  const { scenarios } = await askClaude({ system: SYSTEM, prompt: prompt.filter(Boolean).join('\n\n'), schema: Written })

  // The same limits the database keeps. A scenario with no title or expected result is dropped.
  return scenarios.flatMap((scenario): WrittenScenario[] => {
    const title = scenario.title.trim().slice(0, 300)
    const expected = scenario.expected.trim().slice(0, 2000)
    if (!roles.includes(scenario.role) || !title || !expected) return []
    return [
      {
        role: scenario.role,
        kind: scenario.kind,
        title,
        preconditions: scenario.preconditions?.trim().slice(0, 2000) || null,
        steps: scenario.steps.map((step) => step.trim().slice(0, 1000)).filter(Boolean).slice(0, 50),
        expected,
      },
    ]
  })
}
