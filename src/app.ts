import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import { config } from './config.js'
import { contactRouter } from './features/contact/routes.js'
import { handleErrors, notFound } from './lib/errors.js'
import { logger } from './lib/logger.js'
import { openApiDocument, registry } from './lib/openapi.js'
import { limitRequests } from './lib/rateLimit.js'

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['health'],
  summary: 'Whether the server is up',
  description: 'For load balancers and uptime checks. Not rate limited, and does not touch the database.',
  responses: {
    200: { description: 'Up.', content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } } },
  },
})

/** The whole app, without listening, so tests can start it on any port. Order matters: see docs/architecture.md. */
export function createApp() {
  const app = express()
  app.set('trust proxy', config.TRUST_PROXY)

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }))
  app.use(helmet())
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '100kb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Generous: the frontend polls every 3 seconds while a sync runs. Busy public routes add their own, lower limit.
  app.use('/api', limitRequests(1000, 15), contactRouter)

  if (config.NODE_ENV !== 'production') {
    const document = openApiDocument()
    app.get('/api/openapi.json', (_req, res) => {
      res.json(document)
    })
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(document))
  }

  app.use(notFound)
  app.use(handleErrors)
  return app
}
