import { z } from 'zod'
import { config } from '../config.js'

// Any provider with an OpenAI-compatible chat API: Gemini by default (AI_BASE_URL, AI_MODEL in .env.example).

/** The AI could not answer: refused, overloaded after retries, cut off, or the key is wrong. */
export class AiError extends Error {}

const Answer = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable() })),
})

/**
 * Asks the AI for an answer shaped like `schema` (structured output from its JSON schema), parsed with that schema.
 * Waits and retries up to three times while the provider is busy or rate limits (429, 5xx), as free tiers often do.
 */
export async function askAi<T extends z.ZodType>(request: { system: string; prompt: string; schema: T }): Promise<z.infer<T>> {
  const { $schema: _, ...schema } = z.toJSONSchema(request.schema) as Record<string, unknown>
  const body = JSON.stringify({
    model: config.AI_MODEL,
    // Thinking models count their thinking in this too.
    max_tokens: 32_000,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } },
  })

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${config.AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.AI_API_KEY}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(300_000),
    })
    if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
      await res.body?.cancel()
      const seconds = Math.min(Number(res.headers.get('retry-after')) || 10 * 2 ** attempt, 60)
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      continue
    }
    if (!res.ok) throw new AiError(`The AI answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const [choice] = Answer.parse(await res.json()).choices
    if (choice?.finish_reason === 'length') throw new AiError('The answer was cut off at the token limit')
    let json: unknown
    try {
      json = JSON.parse(choice?.message.content ?? '')
    } catch {
      throw new AiError('The answer was not JSON')
    }
    const parsed = request.schema.safeParse(json)
    if (!parsed.success) throw new AiError(`The answer did not have the asked shape: ${parsed.error.message.slice(0, 300)}`)
    return parsed.data
  }
}
