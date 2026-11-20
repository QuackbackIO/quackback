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

/**
 * How long this process reuses the settings it read, and the copies derived
 * from them: a write made by another process reaches this one within this
 * window, which bounds how late, for example, a changed auth config takes
 * effect there.
 */
export const SETTINGS_LOCAL_TTL_MS = 5_000

/**
 * The window in effect: QUACKBACK_SETTINGS_CACHE_MS overrides it (0 turns the
 * copies off). The perf bench pins it long, so its counts measure a warm process
 * rather than whichever side of the window a request happened to land on.
 */
export function settingsLocalTtlMs(): number {
  const override = Number(process.env.QUACKBACK_SETTINGS_CACHE_MS)
  return Number.isFinite(override) && override >= 0 ? override : SETTINGS_LOCAL_TTL_MS
}

export function localCacheGet<T>(key: string): T | undefined {
  const copy = localCopies.get(key)
  if (!copy) return undefined
  if (copy.expiresAt > Date.now()) return copy.value as T
  localCopies.delete(key)
  return undefined
}

/**
 * Per key, a stamp that changes each time `forgetCachedKeys` drops the key, so
 * a copy read before a drop is not kept after it. Keyed like the copies, so a
 * drop of one key (or in one workspace) leaves reads of the others alone.
 */
const dropStamps = new WorkspaceKeyedCache<number>(1_000)
let lastStamp = 0

/** Pass to {@link localCacheSet} as `readSince`, taken before reading `key`. */
export function localCacheGeneration(key: string): number {
  return dropStamps.get(key) ?? 0
}

/**
 * Keep `value` for `ttlMs`. With `readSince` (a {@link localCacheGeneration}
 * taken before the value was read), a value read before a write dropped the
 * key is not kept: it may be what the write replaced.
 */
export function localCacheSet(
  key: string,
  value: unknown,
  ttlMs: number,
  readSince?: number
): void {
  if (process.env.NODE_ENV !== 'production') return
  if (readSince !== undefined && readSince !== localCacheGeneration(key)) return
  localCopies.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Forget `keys` everywhere this process holds them: the current request's memo
 * (a read memoized under a cache key's name must not outlive the write that
 * invalidated it) and the short-lived copies above.
 */
export function forgetCachedKeys(...keys: string[]): void {
  forgetPerRequest(...keys)
  for (const key of keys) {
    localCopies.delete(key)
    dropStamps.set(key, ++lastStamp)
  }
}
