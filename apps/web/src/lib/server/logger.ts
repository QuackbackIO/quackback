/**
 * Web app logger — thin wrapper over the shared @quackback/logger package.
 *
 * The package owns the implementation (pino, redaction, the OpenTelemetry
 * trace-context mixin, and the AsyncLocalStorage request context). This wrapper
 * binds `service_name` from the process role so a worker replica is not
 * ingested as "quackback-web". Because the context lives in the shared
 * package, logs from @quackback/db and @quackback/email emitted within a
 * request inherit the same request_id/workspace_key automatically.
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

/**
 * Log-store identity for this process.
 *
 * Read from the environment rather than `getProcessRole()`: process-role
 * imports this module, so going the other way is a cycle. Trim matches the
 * role parser; case is not folded. `OTEL_SERVICE_NAME` wins when an operator
 * sets one. `all` (self-host default) and unrecognised values stay
 * `quackback-web` — the closed direction, same as the role fallback.
 */
export function serviceNameForProcess(env: NodeJS.ProcessEnv = process.env): string {
  const otel = env.OTEL_SERVICE_NAME?.trim()
  if (otel) return otel
  switch (env.QUACKBACK_ROLE?.trim()) {
    case 'worker':
      return 'quackback-worker'
    case 'migrator':
      return 'quackback-migrator'
    default:
      return 'quackback-web'
  }
}

/** Build a logger bound to this service. Tests inject a destination here. */
export function createLogger(options: CreateLoggerOptions = {}) {
  return createBaseLogger({
    ...options,
    base: { service_name: serviceNameForProcess(), ...options.base },
  })
}

/** Shared application logger. Level comes from config (LOG_LEVEL). */
export const logger = createLogger()
