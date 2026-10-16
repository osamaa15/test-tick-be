import { z } from 'zod'
import { config } from '../config.js'

// shortcut: one model for every task; give small tasks a cheaper model when the bill says so.
const MODEL = 'claude-sonnet-5-5'

/** Claude could not answer: refused, overloaded after retries, cut off, or the key is wrong. */
export class AiError extends Error {}

const Answer = z.object({
  content: z.array(z.object({ type: z.string(), input: z.unknown().optional() })),
  stop_reason: z.string().nullable(),
})

/**
 * Asks Claude for an answer shaped like `schema`: it must answer by calling one tool whose input is that shape.
 * Waits and retries up to three times while Anthropic is busy (429, 5xx).
 */
export async function askClaude<T extends z.ZodType>(request: {
  system: string
  prompt: string
  schema: T
}): Promise<z.infer<T>> {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(request.schema) as Record<string, unknown>
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 16_000,
    system: request.system,
    messages: [{ role: 'user', content: request.prompt }],
    tools: [{ name: 'answer', description: 'Give your answer.', input_schema: inputSchema }],
    tool_choice: { type: 'tool', name: 'answer' },
  })

  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(300_000),
    })
    if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
      await res.body?.cancel()
      const seconds = Math.min(Number(res.headers.get('retry-after')) || 5 * 2 ** attempt, 60)
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      continue
    }
    if (!res.ok) throw new AiError(`Anthropic answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const answer = Answer.parse(await res.json())
    if (answer.stop_reason === 'max_tokens') throw new AiError('The answer was cut off at the token limit')
    const call = answer.content.find((block) => block.type === 'tool_use')
    const parsed = request.schema.safeParse(call?.input)
    if (!parsed.success) throw new AiError(`The answer did not have the asked shape: ${parsed.error.message.slice(0, 300)}`)
    return parsed.data
  }
}
