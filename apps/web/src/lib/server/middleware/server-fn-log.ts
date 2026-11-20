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
import { getLogContext } from '@/lib/server/log-context'
import { DomainException, HiddenMessageRefusal, isSafeToShow } from '@/lib/shared/errors'
import { UNEXPECTED_ERROR_MESSAGE, withErrorReference } from '@/lib/shared/error-reference'
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
import { isTechnicalFailure, newErrorReference } from './technical-failure'

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
  return (
    candidate.name === 'ZodError' || Array.isArray(candidate.issues) || isSerializedIssueList(error)
  )
}

/**
 * The framework's validator path (`execValidator`) does not rethrow the schema
 * library's error. For a standard-schema validator it throws a plain `Error`
 * whose message is `JSON.stringify(issues)`, so the issues only survive as
 * text. Recognise that exact shape: a non-empty JSON array whose every entry is
 * a standard-schema issue (an object with a string `message`).
 */
function isSerializedIssueList(error: object): boolean {
  if (!(error instanceof Error) || error.name !== 'Error') return false
  const text = error.message.trimStart()
  if (!text.startsWith('[')) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  return (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (issue) =>
        !!issue &&
        typeof issue === 'object' &&
        typeof (issue as { message?: unknown }).message === 'string'
    )
  )
}

/**
 * Some errors carry an HTTP status without extending DomainException — e.g.
 * CopilotUnavailableError. The status is the classification, so read it
 * structurally rather than requiring a particular base class.
 */
function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { statusCode?: unknown }
  return typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined
}

/** The code and status of a refusal below 500, or null for anything else. */
function refusalCodeOf(error: unknown): { code: string; statusCode: number } | null {
  const statusCode = statusCodeOf(error)
  const code = (error as { code?: unknown } | null)?.code
  if (statusCode === undefined || statusCode >= 500 || typeof code !== 'string') return null
  return { code, statusCode }
}

/**
 * Severity for a thrown value, or `null` when it is not a failure at all.
 *
 * `redirect()` and `notFound()` are the framework's sanctioned control flow for
 * server functions — an unauthenticated visitor being sent to the login page is
 * the system working, not an incident.
 *
 * Everything a caller can provoke lands at warn: a permission denial, a bad
 * payload, a missing record. `error` is reserved for failures nobody designed
 * for, which is what makes it worth alerting on.
 */
export function classifyServerFnError(error: unknown): 'warn' | 'error' | null {
  if (isRedirect(error) || isNotFound(error)) return null
  if (error instanceof DomainException) return error.statusCode >= 500 ? 'error' : 'warn'
  // requireAuth throws a plain Error, and it is the most common expected
  // failure in the app — without this every signed-out call would log at error.
  if (isAuthDenialError(error)) return 'warn'
  if (isValidationFailure(error)) return 'warn'
  const status = statusCodeOf(error)
  if (status !== undefined) return status >= 500 ? 'error' : 'warn'
  return 'error'
}

/**
 * Core logging behaviour, decoupled from the framework so it can be unit
 * tested. `log` is injectable as a test seam; production passes the shared
 * logger. Mirrors `handleRequestWithContext` in request-context.ts.
 *
 * A thrown error crosses to the browser with its message intact, and the
 * interface prints it; a typed error below 500 also keeps its code and status
 * (typed-error-serialization.ts). In production only a planned failure keeps its message:
 * one logged at warn (a typed 4xx, an auth denial, a rejected payload), or a
 * failure on our side whose class says its message was written for people
 * (`ServiceUnavailableError`). Anything else, which is every plain
 * `throw new Error(...)`, is swapped here for a plain sentence carrying a
 * reference code, and the code is logged as `error_ref` beside the real error.
 * A warn-level error that still looks technical (a provider's reply carrying a
 * 4xx status) is hidden the same way.
 *
 * `start.ts` imports this file, so in development the browser loads it too
 * (only the `.server()` body is stripped). Its imports must stay safe to
 * evaluate there, which is why production is read from the environment here
 * and not through the server config module.
 */
export async function runWithServerFnLogging<T>({
  next,
  name,
  log = logger,
  production = process.env.NODE_ENV === 'production',
}: {
  next: () => Promise<T>
  name: string
  log?: AppLogger
  production?: boolean
}): Promise<T> {
  const start = performance.now()
  try {
    return await next()
  } catch (error) {
    const severity = classifyServerFnError(error)
    const hidden =
      production &&
      severity !== null &&
      (severity === 'error' ? !isSafeToShow(error) : isTechnicalFailure(error))
    const reference = hidden ? newErrorReference(getLogContext()?.request_id) : null
    if (severity) {
      log[severity](
        {
          err: error,
          duration_ms: Math.round(performance.now() - start),
          server_fn: name,
          ...(reference ? { error_ref: reference } : {}),
        },
        `${name} failed`
      )
    }
    if (reference) {
      const hiddenMessage = withErrorReference(UNEXPECTED_ERROR_MESSAGE, reference)
      // A refusal below 500 keeps its code and status, only its words go.
      const refusal = refusalCodeOf(error)
      if (refusal) {
        throw new HiddenMessageRefusal(refusal.code, refusal.statusCode, hiddenMessage)
      }
      throw new Error(hiddenMessage)
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
