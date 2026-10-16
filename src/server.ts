import { createApp } from './app.js'
import { config } from './config.js'
import { startSyncWorker } from './features/syncs/worker.js'
import { logger } from './lib/logger.js'

const server = createApp().listen(config.PORT, () => {
  logger.info(`Testick API on http://localhost:${config.PORT}` + (config.NODE_ENV === 'production' ? '' : `, docs at /api/docs`))
})
const stopSyncWorker = startSyncWorker()

// Hosts send SIGTERM before stopping an instance: stop taking requests, let the ones in flight finish, then exit.
// A sync in progress is left; its claim runs out and another worker picks it up.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  stopSyncWorker()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
