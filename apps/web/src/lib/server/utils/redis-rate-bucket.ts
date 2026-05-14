/**
 * Redis-backed fixed-window rate-limit primitive. INCR + EXPIRE NX in
 * a single pipeline — the EXPIRE only sets the TTL on the first
 * attempt in the window. Fails open on Redis errors (returns `null`
 * count) so an outage doesn't lock callers out.
 */
import { getRedis } from '@/lib/server/redis'

export interface RateBucketSpec {
  key: string
  windowSeconds: number
}

export interface RateBucketResult {
  /** Post-INCR count, or `null` when Redis errored. */
  count: number | null
}

/** Increment one bucket. Returns the new count, or `null` on Redis error. */
export async function incrementBucket(spec: RateBucketSpec): Promise<RateBucketResult> {
  try {
    const pipeline = getRedis().multi()
    pipeline.incr(spec.key)
    pipeline.expire(spec.key, spec.windowSeconds, 'NX')
    const results = await pipeline.exec()
    return { count: Number(results?.[0]?.[1] ?? 0) }
  } catch (error) {
    console.error(`[redis-rate-bucket] error on ${spec.key}; failing open:`, error)
    return { count: null }
  }
}

/**
 * Increment many buckets in a single Redis pipeline. Returns the
 * post-INCR counts in the same order as the input. Saves one RTT
 * compared to sequential `incrementBucket` calls when the caller
 * needs to check multiple buckets (e.g. per-tuple + per-IP).
 */
export async function incrementBuckets(
  specs: readonly RateBucketSpec[]
): Promise<(number | null)[]> {
  if (specs.length === 0) return []
  try {
    const pipeline = getRedis().multi()
    for (const spec of specs) {
      pipeline.incr(spec.key)
      pipeline.expire(spec.key, spec.windowSeconds, 'NX')
    }
    const results = await pipeline.exec()
    if (!results) return specs.map(() => null)
    // Each spec contributes 2 commands; INCR is the even-indexed reply.
    return specs.map((_, i) => Number(results[i * 2]?.[1] ?? 0))
  } catch (error) {
    console.error('[redis-rate-bucket] pipeline error; failing open:', error)
    return specs.map(() => null)
  }
}

/**
 * Best-effort TTL fetch. Returns the window size as a fallback when
 * Redis reports `-1` (no TTL) or errors.
 */
export async function bucketRetryAfter(spec: RateBucketSpec): Promise<number> {
  try {
    const ttl = await getRedis().ttl(spec.key)
    return ttl > 0 ? ttl : spec.windowSeconds
  } catch {
    return spec.windowSeconds
  }
}
