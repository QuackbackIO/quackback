/**
 * Routes Better-Auth's internal logging into the app logger, redacting payloads.
 *
 * Without this the library logs through its own console sink: unstructured,
 * uncorrelated with the request, invisible to log aggregation — and on a
 * resolution failure it logs the ENTIRE user-info object, email included.
 *
 * Redaction keeps what is diagnostic and drops what is personal. Which claims
 * an IdP returned is exactly what you need to tell the failure modes apart;
 * the claim values are not.
 */

/** Better-Auth's `Logger['log']` levels, minus the unused `success`. */
type AuthLogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogSink {
  error: (payload: unknown, message: string) => void
  warn: (payload: unknown, message: string) => void
  info: (payload: unknown, message: string) => void
  debug: (payload: unknown, message: string) => void
}

/**
 * Reduce each argument to a shape that is safe to persist.
 *
 * Objects become their key names, arrays become a count, and Errors keep only
 * name and message — attached properties are dropped, since library code
 * routinely decorates an error with the context that caused it.
 */
export function redactLogArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg === null || typeof arg !== 'object') return arg
    if (arg instanceof Error) return { error: arg.name, message: arg.message }
    if (Array.isArray(arg)) return { items: arg.length }
    return { keys: Object.keys(arg as Record<string, unknown>) }
  })
}

/**
 * Build the `logger` option for `betterAuth({...})`. `level: 'debug'` lets the
 * library hand everything over; the sink decides what is actually persisted.
 */
export function createAuthLogger(sink: LogSink) {
  return {
    level: 'debug' as const,
    disableColors: true,
    log: (level: AuthLogLevel, message: string, ...args: unknown[]) => {
      const write = sink[level] ?? sink.info
      write({ args: redactLogArgs(args) }, message)
    },
  }
}
