/**
 * Routes the HTTP runtime's own error print through pino.
 *
 * When a non-HTTP error escapes a request, the framework's start handler hands
 * it to h3's `toResponse`, which wraps it in an `HTTPError` marked `unhandled`,
 * answers 500, and prints the wrapper with a bare `console.error(error)`. The
 * handler passes no `silent` flag and no `onError` hook, so there is no
 * configuration to turn this off. Under Bun the print is a multi-line dump: a
 * source excerpt of the h3 bundle around the wrap site (which happens to show
 * the "Cannot find any route matching" line just above it), then every property
 * of the error and its cause, down to each DOMException constant. A line-based
 * log stream turns each of those lines into a separate, unstructured entry.
 *
 * The commonest cause by far is a client closing the connection mid-request:
 * the framework rethrows the request signal's AbortError however the request
 * was going. That is not a fault, and the request boundary already records it,
 * so those prints are dropped. An error the boundary already logged is dropped
 * too. Anything else is logged once as a structured line.
 *
 * Only that exact call shape is intercepted: a single argument that is an
 * unhandled `HTTPError`. Every other `console.error` call passes through.
 */
import type { AppLogger } from '@quackback/logger'
import { logger } from '@/lib/server/logger'

/** Errors the request boundary has already written to the log. */
const loggedAtBoundary = new WeakSet<object>()

/** Record that the request boundary logged this error, so it is not logged twice. */
export function noteLoggedAtBoundary(error: unknown): void {
  if (error && typeof error === 'object') loggedAtBoundary.add(error)
}

/**
 * The error a request's abort signal carries. Under Bun a client disconnect
 * surfaces as `DOMException('The connection was closed.', 'AbortError')`.
 * Read structurally: a DOMException is not an `Error` subclass everywhere.
 */
export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError'
}

interface UnhandledHttpError {
  status?: number
  cause?: unknown
}

/** h3's wrapper for an error it did not expect. Matched by shape: h3 is bundled per consumer. */
function isUnhandledHttpError(value: unknown): value is UnhandledHttpError {
  if (!(value instanceof Error) || value.name !== 'HTTPError') return false
  return (value as { unhandled?: unknown }).unhandled === true
}

const installed = Symbol.for('quackback.runtimeErrorLog')

interface ConsoleLike {
  error: (...args: unknown[]) => void
  [installed]?: true
}

/**
 * Wrap `target.error` (the global console in production) once. `log` and
 * `target` are injectable so tests never patch the real console.
 */
export function installRuntimeErrorLog({
  log = logger.child({ component: 'http-runtime' }),
  target = console as unknown as ConsoleLike,
}: { log?: AppLogger; target?: ConsoleLike } = {}): void {
  if (target[installed]) return
  const passThrough = target.error.bind(target)
  target.error = (...args: unknown[]) => {
    const [first] = args
    if (args.length !== 1 || !isUnhandledHttpError(first)) {
      passThrough(...args)
      return
    }
    const original = first.cause ?? first
    if (isAbortError(original)) return
    if (original && typeof original === 'object' && loggedAtBoundary.has(original)) return
    log.error({ err: original, status: first.status }, 'unhandled request error')
  }
  target[installed] = true
}
