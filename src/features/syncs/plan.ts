import { z } from 'zod'
import { askAi } from '../../lib/ai.js'
import { sha256 } from '../../lib/crypto.js'
import type { FeatureChange } from '../projects/schemas.js'
import type { WrittenScenario } from '../scenarios/writer.js'

// Finding a push's features with the AI, and working out which are new, changed or untouched.

/** A feature as the current sync left it. */
export type KnownFeature = { id: string; name: string; description: string; paths: string[]; code_hash: string | null }

/** A feature as this sync leaves it: what `finish_sync` takes. `scenarios` only for added or changed ones. */
export type PlannedFeature = Omit<KnownFeature, 'id'> & {
  id: string | null
  change: FeatureChange | null
  scenarios: WrittenScenario[]
}

const Discovered = z.object({
  features: z.array(
    z.object({
      name: z.string().describe('A few plain words, such as "Sign in" or "Shopping cart".'),
      description: z.string().describe('One sentence on what it does for the people using the product.'),
      paths: z.array(z.string()).describe('The files that implement it, at most 15, exactly as listed.'),
    }),
  ),
})
export type DiscoveredFeature = z.infer<typeof Discovered>['features'][number]

const SYSTEM = `You read a software repository and list its features for Testick, which writes test scenarios for each one.
- A feature is product functionality that people use or rely on, such as "Sign in", "Shopping cart" or "Password reset". Not a file, a library or a technical layer.
- Name each in a few plain words. When an existing feature is still there, use exactly its existing name.
- Describe each in one sentence about what it does for people.
- For each, list the files that implement it (at most 15), copied exactly from the list of files.
- List at most 30 features, the most important first. Leave out tests, configuration and tooling.`

const MAX_FEATURES = 30
const MAX_PATHS = 15
// About 75k tokens of code for finding features; files past it are listed by path only.
const CODE_BUDGET = 300_000

/** Asks the AI for the features in these files, reusing the names of the ones it already knows. */
export async function discoverFeatures(files: Map<string, string>, known: KnownFeature[]) {
  let room = CODE_BUDGET
  const code = [...files].flatMap(([path, text]) => {
    if (text.length > room) return []
    room -= text.length
    return [`<file path="${path}">\n${text}\n</file>`]
  })
  const prompt = [
    known.length
      ? `Existing features:\n${known.map((feature) => `- ${feature.name}: ${feature.description}`).join('\n')}`
      : 'There are no existing features yet.',
    `Every file in the repository:\n${[...files.keys()].slice(0, 5000).join('\n')}`,
    `Their contents (some are left out for length):\n\n${code.join('\n\n')}`,
  ]
  const { features } = await askAi({ system: SYSTEM, prompt: prompt.join('\n\n'), schema: Discovered })
  return features
}

/**
 * Matches what the AI found to the known features by name. A feature is `added` when its name is new, and
 * `changed` when the code of the files it had is not what it was, or it has no scenarios yet (no hash). It is
 * compared over its old files because the AI lists a feature's files a little differently each time; it keeps
 * the files listed now for the next sync. Names are deduplicated and paths kept to real files.
 */
export function planFeatures(known: KnownFeature[], found: DiscoveredFeature[], files: Map<string, string>): PlannedFeature[] {
  const byName = new Map(known.map((feature) => [feature.name.toLowerCase(), feature]))
  const seen = new Set<string>()
  const hash = (paths: string[]) => sha256(paths.map((path) => `${path}\0${files.get(path)}`).join('\0'))
  return found.flatMap((feature): PlannedFeature[] => {
    const name = feature.name.trim().slice(0, 200)
    if (!name || seen.has(name.toLowerCase()) || seen.size >= MAX_FEATURES) return []
    seen.add(name.toLowerCase())
    const paths = [...new Set(feature.paths)].filter((path) => files.has(path)).sort().slice(0, MAX_PATHS)
    const match = byName.get(name.toLowerCase())
    return [
      {
        id: match?.id ?? null,
        name: match?.name ?? name,
        description: feature.description.trim().slice(0, 1000),
        paths,
        code_hash: hash(paths),
        change: !match ? 'added' : match.code_hash === hash(match.paths) ? null : 'changed',
        scenarios: [],
      },
    ]
  })
}
