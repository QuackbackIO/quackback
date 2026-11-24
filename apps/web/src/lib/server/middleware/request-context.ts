/**
 * Global request middleware — opens the per-request log context and emits
 * access logs.
 *
 * Runs first for every server request (SSR document, server routes, server
 * functions). It:
 *   - derives a stable request_id (inbound x-request-id / x-correlation-id,
 *     else a fresh UUID) and echoes it back on the response for correlation,
 *   - opens the AsyncLocalStorage log context so every `logger.*` call within
 *     the request automatically carries request_id + route,
 *   - logs request completion with status, duration and query count, or
 *     failure on throw (a client disconnect at info, anything else at error);
 *     with QUACKBACK_SERVER_TIMING=1 the same numbers go out as a
 *     Server-Timing header for the browser's network panel.
 *
 * Downstream code enriches the context with workspace_key / user_id via
 * setLogContext() once auth resolves.
 */
import type { AppLogger } from '@quackback/logger'
import { createMiddleware } from '@tanstack/react-start'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'
import { formatServerTiming, openRequestMetrics } from '@/lib/server/request-metrics'
import { onResponseBodyEnd } from '@/lib/server/response-hooks'
import { isClientDisconnect, noteLoggedAtBoundary } from '@/lib/server/runtime-error-log'
import { hideFromClient } from './server-fn-log'

/**
 * Health probe path. Hit every few seconds by the platform's healthcheck,
 * so a successful probe is pure access-log noise. We skip the completion
 * line for healthy probes only — an unhealthy probe (status >= 400)
 * or a thrown error is still logged, since those are the signal we care about.
 */
function isHealthPath(pathname: string): boolean {
  return pathname === '/api/health' || pathname.startsWith('/api/health/')
}

function deriveRequestId(request: Request): string {
  const header = request.headers.get('x-request-id') ?? request.headers.get('x-correlation-id')
  // Cap to keep a malicious/huge header out of every log line.
  if (header) return header.slice(0, 200)
  return crypto.randomUUID()
}

/**
 * Minimal shape of what the framework's `next()` resolves to.
 *
 * `response` is optional on purpose. `next()` returns the request context, and
 * the framework only attaches a response once something downstream produced
 * one — which a failing server function has not yet done at this point.
 */
interface NextResult {
  response?: Response
}

/**
 * Core request handling, decoupled from the framework so it can be unit tested.
 * `log` is injectable as a test seam; production passes the shared logger.
 */
export async function handleRequestWithContext<T extends NextResult>({
  request,
  next,
  handlerType = 'router',
  log = logger,
  serverTiming = process.env.QUACKBACK_SERVER_TIMING === '1',
  production = process.env.NODE_ENV === 'production',
}: {
  request: Request
  next: () => Promise<T>
  handlerType?: 'serverFn' | 'router'
  log?: AppLogger
  serverTiming?: boolean
  production?: boolean
}): Promise<T> {
  const requestId = deriveRequestId(request)
  const pathname = new URL(request.url).pathname
  const route = `${request.method} ${pathname}`
  const start = performance.now()

  return runWithLogContext({ request_id: requestId, route }, async () => {
    const metrics = openRequestMetrics()!
    try {
      const result = await next()
      const durationMs = Math.round(performance.now() - start)
      // `next()` resolves to the framework's context, and `response` is only
      // present once something downstream produced one. A failing server
      // function does not: the error is carried as a value and turned into a
      // response after this middleware returns. Dereferencing it
      // unconditionally threw a TypeError out of this boundary, which the
      // framework then reported to the client as an unhandled 500 in place of
      // the serialized error it had already built.
      const response = result.response
      // Echo the id back so clients/proxies can correlate.
      try {
        response?.headers.set('x-request-id', requestId)
        if (serverTiming) {
          response?.headers.set('server-timing', formatServerTiming(metrics, durationMs))
        }
      } catch {
        // Some responses have immutable headers; correlation still works
        // via the logged request_id.
      }
      const status = response?.status
      // Suppress the completion line for successful health probes. Everything
      // else — and unhealthy probes — still logs.
      const quiet = isHealthPath(pathname) && status !== undefined && status < 400
      if (!quiet) {
        log.info(
          { status, duration_ms: durationMs, db_queries: metrics.dbQueries },
          'request completed'
        )
      }
      // A document streams: queries can still run after the headers left, so
      // the count above can be short. With Server-Timing on, log the final
      // count once the body has been fully written (one line per request).
      if (serverTiming && !quiet) {
        const finish = () =>
          log.info(
            {
              request_id: requestId,
              route,
              status,
              duration_ms: Math.round(performance.now() - start),
              db_queries: metrics.dbQueries,
            },
            'request finished'
          )
        // Never swap the response here: the server entry runs the hook
        // (see response-hooks.ts for why).
        if (response?.body) onResponseBodyEnd(response, finish)
        else finish()
      }
      return result
    } catch (err) {
      const durationMs = Math.round(performance.now() - start)
      const disconnected = isClientDisconnect(err, request)
      // Start answers a server-function call whose request middleware threw by
      // serializing the error into the reply, so it never passes the function
      // middleware that hides technical messages (server-fn-log.ts). Apply the
      // same rule here. A thrown Response is the framework's answer, not a
      // failure, and a disconnect has no one left to answer.
      const { error: shown, reference } =
        handlerType === 'serverFn' && !disconnected && !(err instanceof Response)
          ? hideFromClient(err, { production })
          : { error: err, reference: null }
      const fields = {
        err,
        duration_ms: durationMs,
        db_queries: metrics.dbQueries,
        ...(reference ? { error_ref: reference } : {}),
      }
      // A client that closes the connection mid-request surfaces as the
      // request signal's AbortError. Nothing failed on our side, so it is an
      // access-log line rather than an error. Any other AbortError (our own
      // cancelled work) is a failure like any other.
      if (disconnected) log.info(fields, 'request aborted by client')
      else log.error(fields, 'request failed')
      // Log once here at the boundary, then rethrow so the framework's error
      // handling still runs. The runtime's own print of the same error (or of
      // the sentence standing in for it) is suppressed (runtime-error-log.ts).
      noteLoggedAtBoundary(err)
      noteLoggedAtBoundary(shown)
      throw shown
    }
  })
}

export const requestContextMiddleware = createMiddleware().server(
  ({ next, request, handlerType }) =>
    // Wrap next() so its (awaitable) result is a real Promise; T then infers
    // from the framework's own result type, keeping the return type aligned.
    handleRequestWithContext({ request, handlerType, next: () => Promise.resolve(next()) })
)
