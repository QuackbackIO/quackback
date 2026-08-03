/**
 * Shared CORS + JSON-error helpers for widget API endpoints.
 *
 * Widget endpoints are CORS-open (`Access-Control-Allow-Origin: *`) because
 * they're called from arbitrary host pages embedding the widget iframe.
 * Auth happens via Bearer tokens, never cookies, so allowing all origins
 * does not enable CSRF.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { WidgetContextError } from '@/lib/server/widget/context'

export function widgetCorsHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra)
  h.set('Access-Control-Allow-Origin', '*')
  h.set('Cache-Control', 'no-store')
  return h
}

export function widgetJsonError(
  code: string,
  message: string,
  status: number,
  extra?: HeadersInit
): Response {
  return Response.json({ error: { code, message } }, { status, headers: widgetCorsHeaders(extra) })
}

export function widgetJsonOk<T>(data: T, extra?: HeadersInit): Response {
  return Response.json({ data }, { headers: widgetCorsHeaders(extra) })
}

/**
 * Map a thrown domain error to an HTTP error response. Returns null when the
 * error doesn't map to a known shape so the caller can fall through to a
 * generic 500.
 */
export function mapDomainErrorToResponse(err: unknown): Response | null {
  if (err instanceof NotFoundError) {
    return widgetJsonError(err.code, err.message, 404)
  }
  if (err instanceof ConflictError) {
    return widgetJsonError(err.code, err.message, 409)
  }
  if (err instanceof ValidationError) {
    return widgetJsonError(err.code, err.message, 400)
  }
  if (err instanceof ForbiddenError) {
    return widgetJsonError(err.code, err.message, 403)
  }
  if (err instanceof WidgetContextError) {
    return widgetJsonError(err.code, err.message, 403)
  }
  return null
}
