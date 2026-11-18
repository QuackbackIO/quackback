/**
 * The plan limits inputs cache key, in a leaf module so any service that
 * changes a counted resource can drop it without importing the plan-limits
 * service (and its settings and database graph).
 */
import { CACHE_KEYS, cacheDel } from '@/lib/server/cache'

/**
 * Forget the cached plan limits inputs, so the next read recounts. Call it
 * from every mutation of a counted resource: boards, members and roles,
 * custom roles, status components, sending domains, help center languages.
 * `invalidateSettingsCache()` drops it too.
 */
export async function invalidatePlanLimits(): Promise<void> {
  await cacheDel(CACHE_KEYS.PLAN_LIMITS_INPUTS)
}
