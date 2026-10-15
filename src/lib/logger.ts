import { pino } from 'pino'
import { config } from '../config.js'

export const logger = pino({
  level: config.LOG_LEVEL,
  // Sessions and tokens never reach the logs.
  redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  // Readable lines while developing; one JSON object per line everywhere else, for log tools.
  ...(config.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
})
