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
 *   - logs request completion with status + duration, or failure on throw.
 *
 * Downstream code enriches the context with tenant_id / user_id via
 * setLogContext() once auth resolves.
 */
import type { AppLogger } from '@quackback/logger'
import { createMiddleware } from '@tanstack/react-start'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'

/**
 * k8s liveness/readiness probe path. Hit every ~2s per pod, so a successful
 * probe is pure access-log noise (~40k lines/day/tenant). We skip the
 * completion line for healthy probes only — an unhealthy probe (status >= 400)
 * or a thrown error is still logged, since those are the signal we care about.
 */
const HEALTH_PATH = '/api/health'

function deriveRequestId(request: Request): string {
  const header = request.headers.get('x-request-id') ?? request.headers.get('x-correlation-id')
  // Cap to keep a malicious/huge header out of every log line.
  if (header) return header.slice(0, 200)
  return crypto.randomUUID()
}

/** Minimal shape of what the framework's `next()` resolves to. */
interface NextResult {
  response: Response
}

/**
 * Core request handling, decoupled from the framework so it can be unit tested.
 * `log` is injectable as a test seam; production passes the shared logger.
 */
export async function handleRequestWithContext<T extends NextResult>({
  request,
  next,
  log = logger,
}: {
  request: Request
  next: () => Promise<T>
  log?: AppLogger
}): Promise<T> {
  const requestId = deriveRequestId(request)
  const pathname = new URL(request.url).pathname
  const route = `${request.method} ${pathname}`
  const start = performance.now()

  return runWithLogContext({ request_id: requestId, route }, async () => {
    try {
      const result = await next()
      const durationMs = Math.round(performance.now() - start)
      // Echo the id back so clients/proxies can correlate.
      try {
        result.response.headers.set('x-request-id', requestId)
      } catch {
        // Some responses have immutable headers; correlation still works
        // via the logged request_id.
      }
      const status = result.response.status
      // Suppress the completion line for successful health probes (see
      // HEALTH_PATH). Everything else — and unhealthy probes — still logs.
      if (!(pathname === HEALTH_PATH && status < 400)) {
        log.info({ status, duration_ms: durationMs }, 'request completed')
      }
      return result
    } catch (err) {
      const durationMs = Math.round(performance.now() - start)
      // Log once here at the boundary, then rethrow unchanged so the
      // framework's error handling still runs (no double logging upstream).
      log.error({ err, duration_ms: durationMs }, 'request failed')
      throw err
    }
  })
}

export const requestContextMiddleware = createMiddleware().server(({ next, request }) =>
  // Wrap next() so its (awaitable) result is a real Promise; T then infers
  // from the framework's own result type, keeping the return type aligned.
  handleRequestWithContext({ request, next: () => Promise.resolve(next()) })
)
