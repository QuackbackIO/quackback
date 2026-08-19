/**
 * Shared envelope for the public (unauthenticated, CORS *) widget endpoints:
 * response headers, the JSON error shape, and the per-IP rate limit.
 */
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/redis-rate-bucket'
import { createHash } from 'node:crypto'

/** Every public widget response: any origin may read it, nothing caches it. */
export function widgetCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  }
}

/** The `{ error: { code, message } }` JSON error, with the widget headers. */
export function widgetJsonError(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { ...widgetCorsHeaders(), ...extraHeaders } }
  )
}

export interface PerIpLimitSpec {
  /** Redis key prefix; the bucket key is `<keyPrefix>:ip:<ip>`. */
  keyPrefix: string
  /** Requests allowed per window. */
  limit: number
  windowSeconds: number
  /** 429 body message (surfaces word it for their action). */
  message?: string
}

/**
 * Enforce a fixed-window per-IP limit. Returns the 429 response (with
 * Retry-After) when over the limit, or null to proceed. Redis errors fail
 * open (null count) so an outage doesn't take the endpoint down.
 */
export async function enforcePerIpLimit(
  request: Request,
  spec: PerIpLimitSpec
): Promise<Response | null> {
  const bucket = {
    key: `${spec.keyPrefix}:ip:${getClientIp(request)}`,
    windowSeconds: spec.windowSeconds,
  }
  const { count } = await incrementBucket(bucket)
  if (count === null || count <= spec.limit) return null
  const retryAfter = await bucketRetryAfter(bucket)
  return widgetJsonError(429, 'RATE_LIMITED', spec.message ?? 'Too many requests, slow down', {
    'Retry-After': String(retryAfter),
  })
}

/** Bound widget abuse across IP, bearer session, and workspace. */
export async function enforceWidgetQuota(
  request: Request,
  spec: PerIpLimitSpec & { tenantId: string }
): Promise<Response | null> {
  const auth = request.headers.get('authorization') ?? ''
  const sessionKey = auth
    ? createHash('sha256').update(auth).digest('hex').slice(0, 24)
    : 'anonymous'
  const buckets = [
    { key: `${spec.keyPrefix}:ip:${getClientIp(request)}`, windowSeconds: spec.windowSeconds },
    { key: `${spec.keyPrefix}:session:${sessionKey}`, windowSeconds: spec.windowSeconds },
    { key: `${spec.keyPrefix}:tenant:${spec.tenantId}`, windowSeconds: spec.windowSeconds },
  ]
  const results = await Promise.all(buckets.map((bucket) => incrementBucket(bucket)))
  const blockedIndex = results.findIndex(
    (result) => result.count !== null && result.count > spec.limit
  )
  if (blockedIndex < 0) return null
  const retryAfter = await bucketRetryAfter(buckets[blockedIndex])
  return widgetJsonError(429, 'RATE_LIMITED', spec.message ?? 'Too many requests, slow down', {
    'Retry-After': String(retryAfter),
  })
}
