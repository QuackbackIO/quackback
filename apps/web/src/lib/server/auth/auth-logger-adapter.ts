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
 * Build the `logger` option for `betterAuth({...})`.
 *
 * `level` defaults to `info` rather than `debug` on purpose: the library filters
 * by this before calling back, and redaction allocates. Asking for debug would
 * pay that cost on every internal trace only for pino to discard the record,
 * since production runs at info. Pass a level explicitly to widen it.
 */
export function createAuthLogger(sink: LogSink, level: AuthLogLevel = 'info') {
  return {
    level,
    disableColors: true,
    log: (level: AuthLogLevel, message: string, ...args: unknown[]) => {
      // Called as a METHOD on `sink`, never as a detached function. pino's
      // `error`/`warn`/`info` read instance state off `this` (`msgPrefixSym`
      // among others), so `const write = sink[level]; write(...)` throws
      // `undefined is not an object (evaluating 'this[msgPrefixSym]')` — and
      // because better-auth calls this from inside its request handling, that
      // throw surfaces as an unhandled **HTTP 500 on a successful sign-in**.
      //
      // Observed live on the pooled fleet: `/api/auth/get-session` returned 200
      // with no cookie and 500 with a *valid* session cookie, because only the
      // success path logged anything.
      //
      // The existing suite could not catch it: its sink is a plain object of
      // `vi.fn()`s, which do not care what `this` is. Bound below, and the new
      // case supplies a sink that does.
      const method = sink[level] ? level : 'info'
      sink[method]({ args: redactLogArgs(args) }, message)
    },
  }
}
