/**
 * Web app logger — thin wrapper over the shared @quackback/logger package.
 *
 * The package owns the implementation (pino, redaction, the OpenTelemetry
 * trace-context mixin, and the AsyncLocalStorage request context). This wrapper
 * only fixes the service identity to "quackback-web"; because the context lives
 * in the shared package, logs from @quackback/db and @quackback/email emitted
 * within a request inherit the same request_id/tenant_id automatically.
 *
 * Server-only: the Vite config aliases this module to logger.client-stub.ts for
 * the client environment so pino + node:async_hooks never enter the browser.
 *
 * Usage:
 *   import { logger } from '@/lib/server/logger'
 *   logger.info({ post_id }, 'post created')
 *   const log = logger.child({ component: 'feedback' })
 */
import {
  createLogger as createBaseLogger,
  type CreateLoggerOptions,
  type LogLevel,
} from '@quackback/logger'

export type { CreateLoggerOptions, LogLevel }

/** Build a logger bound to this service. Tests inject a destination here. */
export function createLogger(options: CreateLoggerOptions = {}) {
  return createBaseLogger({
    ...options,
    base: { service_name: 'quackback-web', ...options.base },
  })
}

/** Shared application logger. Level comes from config (LOG_LEVEL). */
export const logger = createLogger()
