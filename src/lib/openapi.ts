import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

/** Each feature's routes file registers its paths here, next to the route itself. */
export const registry = new OpenAPIRegistry()

const ErrorBody = z
  .object({
    error: z.object({
      message: z.string(),
      issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  })
  .meta({ id: 'Error' })

const errorDescriptions = {
  400: 'The request is not valid. `issues` says which fields are wrong.',
  404: 'Not found, or not yours to see.',
  429: 'Too many requests. The `RateLimit` header says when to try again.',
} as const

/** The error answers a route can give, to spread into its `responses`. */
export function errorResponses(...statuses: (keyof typeof errorDescriptions)[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      { description: errorDescriptions[status], content: { 'application/json': { schema: ErrorBody } } },
    ]),
  )
}

export function openApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Testick API',
      version: '0.1.0',
      description: 'What the Testick frontend calls. The contract it builds against is `frontend/docs/api-contract.md`.',
    },
  })
}
