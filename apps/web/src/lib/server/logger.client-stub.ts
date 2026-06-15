/**
 * Client-side no-op stand-in for the server logger.
 *
 * The real logger (`./logger.ts`) pulls in pino + node:async_hooks and is
 * server-only. `createServerFn` modules reference a module-scoped
 * `logger.child({ component })` at the top level; that statement runs at import
 * time, so without this stub it would drag pino into the browser bundle (the
 * handler bodies that actually log are stripped from the client, but the
 * top-level binding is not). The Vite config aliases `@/lib/server/logger` to
 * this file for the client environment only — SSR and the server runtime use
 * the real logger. Shapes match so the no-op references resolve cleanly.
 */
type LogFn = (...args: unknown[]) => void

export interface StubLogger {
  trace: LogFn
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  fatal: LogFn
  child: (bindings?: Record<string, unknown>) => StubLogger
  level: string
}

const noop: LogFn = () => {}

function makeStub(): StubLogger {
  const stub: StubLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => stub,
    level: 'silent',
  }
  return stub
}

export const logger: StubLogger = makeStub()

export function createLogger(): StubLogger {
  return makeStub()
}
