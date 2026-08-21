/**
 * Postgres-backed fixed-window rate-limit primitive.
 *
 * Successor to `utils/redis-rate-bucket.ts`. One
 * `INSERT … ON CONFLICT DO UPDATE` per check, which is the honest cost of the
 * change: a database round trip where Redis served a sub-millisecond INCR, on
 * the sign-in and widget hot paths. The measurement is in `KV.md`.
 *
 * The contract the callers rely on is unchanged, including the failure
 * direction: **fails OPEN** (returns a `null` count) so a store outage does not
 * lock every caller out of sign-in. Nothing here decides policy — the
 * per-endpoint limits live in `auth/signin-rate-limit.ts`,
 * `auth/widget-rate-limit.ts`, `domains/api/rate-limit.ts` and their siblings.
 *
 * ## The tenant is in the key, and that is load-bearing
 *
 * Bucket names are built from identifiers that only mean something inside one
 * workspace — a principal id, an email, an IP paired with an action. Left
 * undiscriminated, one workspace's traffic spends another's budget: a denial of
 * service that needs no credentials. `pg-kv.ts` writes
 * `rate_bucket.tenant_id` from the same `currentTenantNamespace()` that built
 * the Redis `t:<tenantId>:` prefix, and every read filters on it. Under pooled
 * tenancy the row is additionally in the tenant's own database.
 */
import {
  incrementRateBucket,
  incrementRateBuckets,
  rateBucketRetryAfter,
} from '@/lib/server/kv/pg-kv'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'rate-bucket' })

export interface RateBucketSpec {
  /** Logical bucket name. Discriminated by tenant before it reaches a row. */
  key: string
  windowSeconds: number
}

export interface RateBucketResult {
  /** Post-increment count, or `null` when the store errored. */
  count: number | null
}

/** Increment one bucket. Returns the new count, or `null` on error. */
export async function incrementBucket(spec: RateBucketSpec): Promise<RateBucketResult> {
  try {
    const state = await incrementRateBucket(spec)
    return { count: state.count }
  } catch (error) {
    log.error({ err: error, key: spec.key }, 'bucket increment failed, failing open')
    return { count: null }
  }
}

/**
 * Increment many buckets in one statement. Returns the post-increment counts in
 * the same order as the input — one round trip rather than N, which is the
 * shape the per-tuple + per-IP callers were already written for.
 */
export async function incrementBuckets(
  specs: readonly RateBucketSpec[]
): Promise<(number | null)[]> {
  if (specs.length === 0) return []
  try {
    const states = await incrementRateBuckets(specs)
    return states.map((s) => s.count)
  } catch (error) {
    log.error({ err: error }, 'batch increment failed, failing open')
    return specs.map(() => null)
  }
}

/**
 * Best-effort TTL fetch, for the `Retry-After` header. Returns the window size
 * as a fallback when the bucket is absent or the store errors.
 *
 * Only ever called on the throttled path, so the extra round trip it costs is
 * paid by requests that are already being refused.
 */
export async function bucketRetryAfter(spec: RateBucketSpec): Promise<number> {
  try {
    return await rateBucketRetryAfter(spec)
  } catch {
    return spec.windowSeconds
  }
}
