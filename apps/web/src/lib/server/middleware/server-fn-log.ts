/**
 * Global server-function failure logging.
 *
 * Server functions never reach the request boundary's error branch. TanStack
 * captures a throw as a value inside the middleware chain and serializes it
 * into the response without changing the status, so `request-context.ts` sees a
 * resolved `next()` and records `request completed` at 200. This middleware is
 * therefore the only place a failing server function can be logged with pino
 * and the per-request context.
 *
 * Registered once as `functionMiddleware` in `start.ts`, so it covers every
 * `createServerFn` in the app and there is no per-handler wiring to forget.
 */
import { createMiddleware } from '@tanstack/react-start'
import { isNotFound, isRedirect } from '@tanstack/react-router'
import type { AppLogger } from '@quackback/logger'
import { logger } from '@/lib/server/logger'
import { DomainException } from '@/lib/shared/errors'

/**
 * Input validators run inside the middleware chain, upstream of the handler, so
 * their rejections surface here. A malformed payload is a caller problem (stale
 * client, bot, hand-rolled request), not a fault of ours, and logging it at
 * error would drown the signal this middleware exists to provide.
 *
 * Matched structurally rather than with `instanceof ZodError` so the check does
 * not pin a zod version, and so standard-schema adapters are covered too.
 */
function isValidationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; issues?: unknown }
  return candidate.name === 'ZodError' || Array.isArray(candidate.issues)
}

/**
 * Severity for a thrown value, or `null` when it is not a failure at all.
 *
 * `redirect()` and `notFound()` are the framework's sanctioned control flow for
 * server functions — an unauthenticated visitor being sent to the login page is
 * the system working, not an incident.
 */
export function classifyServerFnError(error: unknown): 'warn' | 'error' | null {
  if (isRedirect(error) || isNotFound(error)) return null
  if (error instanceof DomainException) return error.statusCode >= 500 ? 'error' : 'warn'
  if (isValidationFailure(error)) return 'warn'
  return 'error'
}

/**
 * Core logging behaviour, decoupled from the framework so it can be unit
 * tested. `log` is injectable as a test seam; production passes the shared
 * logger. Mirrors `handleRequestWithContext` in request-context.ts.
 */
export async function runWithServerFnLogging<T>({
  next,
  name,
  log = logger,
}: {
  next: () => Promise<T>
  name: string
  log?: AppLogger
}): Promise<T> {
  const start = performance.now()
  try {
    return await next()
  } catch (error) {
    const severity = classifyServerFnError(error)
    if (severity) {
      // Rethrown unchanged below, so the framework's own handling is untouched.
      log[severity](
        { err: error, duration_ms: Math.round(performance.now() - start), server_fn: name },
        `${name} failed`
      )
    }
    throw error
  }
}

export const serverFnLogMiddleware = createMiddleware({ type: 'function' }).server(
  ({ next, serverFnMeta }) =>
    runWithServerFnLogging({
      // Wrap so the (awaitable) framework result is a real Promise; T then
      // infers from it, keeping the middleware's return type aligned.
      next: () => Promise.resolve(next()),
      name: serverFnMeta.name,
    })
)
