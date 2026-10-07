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
 * the framework rethrows the request signal's reason, an AbortError, however
 * the request was going. That is not a fault, and the request boundary records
 * it, so the boundary marks the disconnect and the print is dropped. An error
 * the boundary already logged is marked and dropped too. Anything else,
 * including an AbortError that is not the client's (our own cancelled work),
 * is logged once as a structured line.
 *
 * Only that exact call shape is intercepted: a single argument that is an
 * unhandled `HTTPError`. Every other `console.error` call passes through.
 */
import type { AppLogger } from '@quackback/logger'
import { logger } from '@/lib/server/logger'

/**
 * Errors the request boundary has already accounted for: logged, or a client
 * disconnect it recorded. Kept on `globalThis` rather than in module scope
 * because the console wrapper outlives a dev module reload (its install guard
 * lives on the console): the old wrapper and the reloaded boundary must read
 * and write the same set.
 */
const accountedKey = Symbol.for('quackback.runtimeErrorLog.accounted')
const accountedFor: WeakSet<object> = ((globalThis as Record<symbol, unknown>)[accountedKey] ??=
  new WeakSet<object>()) as WeakSet<object>

/** Record that the request boundary logged this error, so it is not logged twice. */
export function noteLoggedAtBoundary(error: unknown): void {
  if (error && typeof error === 'object') accountedFor.add(error)
}

/**
 * Whether `error` is this request's client disconnect: the request's own
 * signal has aborted and the error is its reason, or an AbortError raised
 * because of it. Under Bun the reason is
 * `DOMException('The connection was closed.', 'AbortError')`. An AbortError
 * while the client is still connected is our own cancelled work, not this.
 * The name is read structurally: a DOMException is not an `Error` subclass
 * everywhere.
 */
export function isClientDisconnect(error: unknown, request: Request): boolean {
  const { signal } = request
  if (!signal.aborted) return false
  if (error === signal.reason) return true
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError'
}

/**
 * Account for this request's disconnect whenever it happens. The framework can
 * rethrow the signal's reason after the boundary has already returned, where
 * the boundary's catch never sees it.
 */
export function noteClientDisconnectOf(request: Request): void {
  const { signal } = request
  const note = () => noteLoggedAtBoundary(signal.reason)
  if (signal.aborted) note()
  else signal.addEventListener('abort', note, { once: true })
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
    if (original && typeof original === 'object' && accountedFor.has(original)) return
    log.error({ err: original, status: first.status }, 'unhandled request error')
  }
  target[installed] = true
}
