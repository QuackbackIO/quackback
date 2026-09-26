/**
 * Copies held in this process for a few seconds, for a value nearly every
 * request reads and almost nothing changes (the workspace settings), so a busy
 * process skips most of those `kv_store` round trips. `cacheDel` drops a copy
 * at once (through `forgetCachedKeys`); a write made by another process is seen
 * here once the copy expires.
 *
 * Production only: in development a row edited by hand or by a test script is
 * expected to show on the next request.
 */
import { forgetPerRequest } from '@/lib/server/request-memo'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'

const localCopies = new WorkspaceKeyedCache<{ value: unknown; expiresAt: number }>(1_000)

export function localCacheGet<T>(key: string): T | undefined {
  const copy = localCopies.get(key)
  if (!copy) return undefined
  if (copy.expiresAt > Date.now()) return copy.value as T
  localCopies.delete(key)
  return undefined
}

export function localCacheSet(key: string, value: unknown, ttlMs: number): void {
  if (process.env.NODE_ENV !== 'production') return
  localCopies.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Forget `keys` everywhere this process holds them: the current request's memo
 * (a read memoized under a cache key's name must not outlive the write that
 * invalidated it) and the short-lived copies above.
 */
export function forgetCachedKeys(...keys: string[]): void {
  forgetPerRequest(...keys)
  for (const key of keys) localCopies.delete(key)
}
