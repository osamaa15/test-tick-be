import { z } from 'zod'
import { config } from '../config.js'
import { logger } from './logger.js'

// Any provider with an OpenAI-compatible chat API: Gemini by default (AI_BASE_URL, AI_MODEL in .env.example).

/** The AI could not answer: refused, busy after every retry, cut off, or the key is wrong. */
export class AiError extends Error {}

/** Every model has used up its requests for the day (Gemini's free tier counts them per model per day). */
export class AiLimitError extends AiError {}

const Answer = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable() })),
})

const models = config.AI_MODEL.split(',').map((model) => model.trim()).filter(Boolean)
const ROUNDS = 5
// Models that answered "no requests left today", until when they are skipped. An hour, not until Google's reset at
// midnight Pacific: one refused request an hour costs nothing, and it needs no time zone arithmetic.
const usedUpUntil = new Map<string, number>()

/**
 * Asks the AI for an answer shaped like `schema` (structured output from its JSON schema), parsed with that schema.
 * Free tiers are often busy (429, 5xx) or drop the connection: the next model in AI_MODEL is tried at once, and
 * after every model was busy it waits (20, 40, then 60 seconds) and goes round again, five rounds in all: about 3 minutes.
 * A model out of requests for the day is skipped; when all are, it fails at once with an AiLimitError, sending nothing.
 */
export async function askAi<T extends z.ZodType>(request: { system: string; prompt: string; schema: T }): Promise<z.infer<T>> {
  const { $schema: _, ...schema } = z.toJSONSchema(request.schema) as Record<string, unknown>
  const body = (model: string) =>
    JSON.stringify({
      model,
      // Thinking models count their thinking in this too.
      max_tokens: 32_000,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } },
    })

  for (let attempt = 0; ; attempt++) {
    const ready = models.filter((model) => (usedUpUntil.get(model) ?? 0) <= Date.now())
    if (ready.length === 0) throw new AiLimitError('Every AI model has used up its requests for today')
    const model = ready[attempt % ready.length] ?? ''
    const busy = async (why: string) => {
      if (attempt + 1 >= ROUNDS * models.length) throw new AiError(`The AI stayed busy: ${why}`)
      logger.warn({ model, attempt: attempt + 1, why }, 'the AI was busy or unreachable, trying again')
      const round = Math.floor(attempt / ready.length) + 1
      if ((attempt + 1) % ready.length === 0) await new Promise((resolve) => setTimeout(resolve, Math.min(20 * round, 60) * 1000))
    }

    let res: Response
    try {
      res = await fetch(`${config.AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.AI_API_KEY}`, 'content-type': 'application/json' },
        body: body(model),
        signal: AbortSignal.timeout(300_000),
      })
    } catch (err) {
      // A dropped connection is worth another try; a request that ran 5 minutes is not.
      if (!(err instanceof TypeError)) throw new AiError(`The AI did not answer in time (${model})`)
      await busy(`${model}: ${err.message} (${(err.cause as { code?: string } | undefined)?.code ?? 'no code'})`)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      const refusal = await res.text()
      // Gemini names the quota it hit: a per-day one will not come back by waiting minutes.
      if (res.status === 429 && /PerDay/.test(refusal)) {
        usedUpUntil.set(model, Date.now() + 3_600_000)
        logger.warn({ model }, 'the AI model has used up its requests for today, skipping it for an hour')
        attempt-- // not a try: the next model goes at once, in order
        continue
      }
      await busy(`${model} answered ${res.status}`)
      continue
    }
    if (!res.ok) throw new AiError(`${model} answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
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
