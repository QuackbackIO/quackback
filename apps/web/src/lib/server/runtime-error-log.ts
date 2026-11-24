/**
 * Routes errors that escape a request through pino instead of the framework's
 * own print.
 *
 * When an error escapes the server entry, the framework's `createServerEntry`
 * catches it, answers 500 and prints the thrown value with a bare
 * `console.error(error)` (`resolveErrorStatus` in start-server-core). It does
 * the same, from the same function, when request middleware throws on a
 * server-function request. There is no `silent` flag or `onError` hook to turn
 * this off. Under Bun the print is a multi-line dump of the error and every
 * property of its cause, down to each DOMException constant, and a line-based
 * log stream turns each of those lines into a separate, unstructured entry.
 *
 * Two pieces cooperate:
 *
 * - The request boundary (request-context.ts) and the server entry
 *   (`withRuntimeErrorLog` below) account for every error they see: the
 *   boundary logs it, the entry answers anything escaping it with the
 *   framework's own error response and logs what the boundary did not, and
 *   both record client disconnects without an error line.
 * - The console wrapper drops the framework's print of an error that has been
 *   accounted for. It matches by identity, because the print carries the raw
 *   thrown value with nothing to tell it from any other `console.error(err)`.
 *
 * The commonest escape by far is a client closing the connection mid-request:
 * the framework rethrows the request signal's reason, an AbortError, however
 * the request was going, sometimes before any middleware has run. That is not
 * a fault, so it is recorded and the print is dropped. Anything else,
 * including an AbortError that is not the client's (our own cancelled work), is
 * logged once as a structured line.
 *
 * Only a single-argument call whose argument has been accounted for is
 * dropped. Every other `console.error` call passes through, including the
 * framework's print of a server-function request it fails itself (an
 * unreadable payload, an unknown function id): that error is answered inside
 * the handler, so neither the boundary nor the entry ever sees it.
 */
import type { AppLogger } from '@quackback/logger'
import { logger } from '@/lib/server/logger'

/**
 * Errors already accounted for: logged, or a client disconnect recorded. Kept
 * on `globalThis` rather than in module scope because the console wrapper
 * outlives a dev module reload (its install guard lives on the console): the
 * old wrapper and the reloaded boundary must read and write the same set.
 */
const accountedKey = Symbol.for('quackback.runtimeErrorLog.accounted')
const accountedFor: WeakSet<object> = ((globalThis as Record<symbol, unknown>)[accountedKey] ??=
  new WeakSet<object>()) as WeakSet<object>

/** Record that this error has been logged, so the framework's print of it is dropped. */
export function noteLoggedAtBoundary(error: unknown): void {
  if (error && typeof error === 'object') accountedFor.add(error)
}

function isAccountedFor(error: unknown): boolean {
  return !!error && typeof error === 'object' && accountedFor.has(error)
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
 * Account for this request's disconnect whenever it happens, so the
 * framework's print of the signal's reason is dropped wherever it is printed,
 * including inside the server-function handler, which answers its own
 * failures without rethrowing them.
 */
function noteClientDisconnectOf(request: Request): void {
  const { signal } = request
  const note = () => noteLoggedAtBoundary(signal.reason)
  if (signal.aborted) note()
  else signal.addEventListener('abort', note, { once: true })
}

/**
 * Wrap the server entry's fetch. An error escaping it is answered by
 * `toResponse` (the framework's `handleStartError`, which keeps response
 * helper status, headers and cookies), and logged once with that status unless
 * the request boundary already logged it or it is the client's disconnect.
 */
export function withRuntimeErrorLog<A extends unknown[]>(
  fetch: (request: Request, ...rest: A) => Promise<Response>,
  {
    toResponse,
    log = logger.child({ component: 'http-runtime' }),
  }: { toResponse: (error: unknown) => Response; log?: AppLogger }
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    noteClientDisconnectOf(request)
    try {
      return await fetch(request, ...rest)
    } catch (error) {
      const report = !isAccountedFor(error) && !isClientDisconnect(error, request)
      // Marked first, so the framework's own print of it is dropped.
      noteLoggedAtBoundary(error)
      const response = toResponse(error)
      if (report) log.error({ err: error, status: response.status }, 'unhandled request error')
      return response
    }
  }
}

const installed = Symbol.for('quackback.runtimeErrorLog')

interface ConsoleLike {
  error: (...args: unknown[]) => void
  [installed]?: true
}

/**
 * Wrap `target.error` (the global console in production) once, dropping the
 * framework's print of an error already accounted for. `target` is injectable
 * so tests never patch the real console.
 */
export function installRuntimeErrorLog({
  target = console as unknown as ConsoleLike,
}: { target?: ConsoleLike } = {}): void {
  if (target[installed]) return
  const passThrough = target.error.bind(target)
  target.error = (...args: unknown[]) => {
    if (args.length === 1 && isAccountedFor(args[0])) return
    passThrough(...args)
  }
  target[installed] = true
}
