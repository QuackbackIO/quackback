/**
 * Shared envelope for the public (unauthenticated, CORS *) widget endpoints:
 * response headers, the JSON error shape, and the per-IP rate limit.
 */
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/rate-bucket'
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
  /** Bucket key prefix; the bucket key is `<keyPrefix>:ip:<ip>`. */
  keyPrefix: string
  /** Requests allowed per window. */
  limit: number
  windowSeconds: number
  /** 429 body message (surfaces word it for their action). */
  message?: string
}

/**
 * Enforce a fixed-window per-IP limit. Returns the 429 response (with
 * Retry-After) when over the limit, or null to proceed. Store errors fail
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

export interface WidgetQuotaSpec extends PerIpLimitSpec {
  /** The resolved workspace's id, never a caller-supplied header. */
  workspaceKey: string
  /**
   * Requests allowed per window across the whole workspace. Every visitor
   * shares this count, so it sits well above `limit`: at `limit`, one
   * visitor's burst would refuse every other visitor for the window.
   */
  workspaceLimit: number
}

/**
 * Bound widget abuse across IP, bearer session, and workspace. The address and
 * the session are one visitor's own counts, each held to `limit`; the
 * workspace count is shared by every visitor and held to `workspaceLimit`. A
 * caller with no bearer token has no session to count (its address already
 * is its own count), so signed-out visitors never share one bucket.
 *
 * The visitor's own counts are checked first, and a request they refuse never
 * reaches the workspace count: a visitor who keeps sending after being refused
 * spends only their own budget, never everyone else's.
 */
export async function enforceWidgetQuota(
  request: Request,
  spec: WidgetQuotaSpec
): Promise<Response | null> {
  const auth = request.headers.get('authorization') ?? ''
  const visitorBuckets = [
    { key: `${spec.keyPrefix}:ip:${getClientIp(request)}`, windowSeconds: spec.windowSeconds },
  ]
  if (auth) {
    const sessionKey = createHash('sha256').update(auth).digest('hex').slice(0, 24)
    visitorBuckets.push({
      key: `${spec.keyPrefix}:session:${sessionKey}`,
      windowSeconds: spec.windowSeconds,
    })
  }
  const visitorCounts = await Promise.all(visitorBuckets.map((bucket) => incrementBucket(bucket)))
  const visitorBlocked = visitorCounts.findIndex(
    (result) => result.count !== null && result.count > spec.limit
  )
  if (visitorBlocked >= 0) return quotaRefusal(visitorBuckets[visitorBlocked]!, spec)

  const workspaceBucket = {
    key: `${spec.keyPrefix}:workspace:${spec.workspaceKey}`,
    windowSeconds: spec.windowSeconds,
  }
  const { count } = await incrementBucket(workspaceBucket)
  if (count !== null && count > spec.workspaceLimit) return quotaRefusal(workspaceBucket, spec)
  return null
}

async function quotaRefusal(
  bucket: { key: string; windowSeconds: number },
  spec: WidgetQuotaSpec
): Promise<Response> {
  const retryAfter = await bucketRetryAfter(bucket)
  return widgetJsonError(429, 'RATE_LIMITED', spec.message ?? 'Too many requests, slow down', {
    'Retry-After': String(retryAfter),
  })
}
