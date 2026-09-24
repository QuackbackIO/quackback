/**
 * Request-scoped memoization for the auth helpers.
 *
 * `requireAuth` / `getOptionalAuth` run on ~95 server functions, each doing a
 * session lookup + settings read + principal read + permission join. Within a
 * single HTTP request the same helper is frequently called many times (a route
 * loader plus every server fn it fans out to), re-resolving identical data on
 * each call.
 *
 * The global request middleware (`request-context.ts`) opens an
 * AsyncLocalStorage log-context object at the very start of every request —
 * SSR document, server route, and server function alike — so that object is a
 * live, per-request, mutable scratch space reachable from here via
 * `getLogContext()`. We hang a small memo bag off it keyed by a private symbol.
 *
 * When there is no active request scope (unit tests, background jobs), the memo
 * transparently degrades to "compute every time" — correctness is unaffected,
 * only the dedup is skipped.
 *
 * Cache lifetime is exactly one request: the store object is created fresh per
 * request by `runWithLogContext`, so nothing leaks across requests and there is
 * no revocation concern beyond the single request already in flight.
 *
 * Every key is partitioned by the active workspace. A workspace scope copies
 * its parent's fields forward, symbol keys included, so a memo bag opened
 * before a scope is shared with it; the partition keeps one workspace's entry
 * from ever answering for another.
 */
import { getLogContext } from '@/lib/server/log-context'
import { currentWorkspaceNamespace } from '@/lib/server/workspaces/workspace-keyed'

const MEMO_KEY = Symbol.for('quackback.authRequestMemo')

interface AuthMemo {
  [key: string]: Promise<unknown> | undefined
}

function getMemo(): AuthMemo | null {
  const store = getLogContext() as (Record<PropertyKey, unknown> & AuthMemo) | undefined
  if (!store) return null
  let memo = store[MEMO_KEY as unknown as string] as AuthMemo | undefined
  if (!memo) {
    memo = {}
    // The store carries an index signature, so attaching our bag is type-safe.
    ;(store as Record<PropertyKey, unknown>)[MEMO_KEY] = memo
  }
  return memo
}

function scopedKey(key: string): string {
  return `${currentWorkspaceNamespace()}\u0000${key}`
}

/**
 * Resolve `compute()` at most once per request under `key`, sharing the result
 * (and any in-flight promise) with every later caller in the same request.
 *
 * The promise — not its resolved value — is memoized, so concurrent callers
 * dedupe onto one computation. A rejected promise is evicted so a transient
 * failure doesn't poison the rest of the request.
 */
export function memoizePerRequest<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const memo = getMemo()
  if (!memo) return compute()

  const slot = scopedKey(key)
  const existing = memo[slot] as Promise<T> | undefined
  if (existing) return existing

  const pending = compute().catch((err) => {
    // Evict on failure so the next caller retries rather than replaying the error.
    if (memo[slot] === pending) delete memo[slot]
    throw err
  })
  memo[slot] = pending
  return pending
}

/**
 * Record `value` under `key` for the rest of the request, as though a
 * `memoizePerRequest` call had just resolved to it. For a writer that already
 * holds the fresh value (a lazily created row), so the next reader does not
 * fetch it again.
 */
export function rememberPerRequest<T>(key: string, value: T): void {
  const memo = getMemo()
  if (memo) memo[scopedKey(key)] = Promise.resolve(value)
}

/**
 * Drop `keys` from this request's memo so the next reader resolves them afresh.
 * Called after a write that changes what a memoized read returned.
 */
export function forgetPerRequest(...keys: string[]): void {
  const memo = getMemo()
  if (!memo) return
  for (const key of keys) delete memo[scopedKey(key)]
}

/** Drop every key that starts with `prefix` from this request's memo. */
export function forgetPerRequestPrefix(prefix: string): void {
  const memo = getMemo()
  if (!memo) return
  const scoped = scopedKey(prefix)
  for (const slot of Object.keys(memo)) if (slot.startsWith(scoped)) delete memo[slot]
}
