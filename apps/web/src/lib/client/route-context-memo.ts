/**
 * Client-side reuse of the identity-bound route context.
 *
 * The router runs every matched route's beforeLoad on each navigation and on
 * each intent preload, and no run sees the last one's result. A person's click
 * is up to three of them: the hover preload, the preload the press's focus
 * queues, and the navigation itself. The root route's bootstrap payload and the
 * admin shell's role guard are server calls whose answers change only when the
 * viewer, their role or the workspace's settings do, so each click asked the
 * server the same questions up to three times, and every later click asked
 * again.
 *
 * A memo keeps one answer, shared with a call still in flight, until the first
 * of:
 *
 * - `expireRouteContext()`, which runs on every `router.invalidate()` (sign-in,
 *   sign-out and every settings or profile change already call it to refresh
 *   this context), after every server function called with POST (whatever this
 *   page changes, the next navigation sees; route-context-middleware.ts), and
 *   whenever Better Auth reports a session change;
 * - the page coming back into view, since another tab may have signed out or
 *   switched accounts meanwhile;
 * - {@link ROUTE_CONTEXT_MAX_AGE_MS}, a backstop for changes made elsewhere
 *   (a teammate editing settings, an admin changing this viewer's role) that
 *   nothing here can observe.
 *
 * A failed call is never kept. On the server nothing is kept at all: module
 * state there is shared by every request.
 */

export const ROUTE_CONTEXT_MAX_AGE_MS = 60_000

let generation = 0

/** Forget every kept answer; the next navigation or preload asks the server again. */
export function expireRouteContext(): void {
  generation++
}

export interface RouteContextMemo<T> {
  /** The kept answer while it is current, else `load()`'s, which is then kept. */
  get(load: () => Promise<T>): Promise<T>
  /**
   * Keep the answer the page was server-rendered with, so the first navigation
   * after hydration need not ask again. Takes effect once per page load, and
   * only if nothing has been fetched or expired before it.
   */
  seed(value: T): void
}

const onServer = () => typeof window === 'undefined'

export function createRouteContextMemo<T>(): RouteContextMemo<T> {
  let kept: { generation: number; at: number; value: Promise<T> } | null = null
  let seeded = false

  const isCurrent = () =>
    kept !== null &&
    kept.generation === generation &&
    Date.now() - kept.at < ROUTE_CONTEXT_MAX_AGE_MS

  return {
    get(load) {
      if (onServer()) return load()
      if (isCurrent()) return kept!.value
      const entry = { generation, at: Date.now(), value: load() }
      kept = entry
      entry.value.catch(() => {
        if (kept === entry) kept = null
      })
      return entry.value
    },
    seed(value) {
      if (onServer() || seeded) return
      seeded = true
      if (kept !== null || generation !== 0) return
      kept = { generation, at: Date.now(), value: Promise.resolve(value) }
    },
  }
}

/**
 * Make `router.invalidate()` expire the kept context before it reloads, so the
 * beforeLoads it re-runs ask the server again.
 */
export function expireRouteContextOnInvalidate<
  R extends { invalidate: (...args: never[]) => unknown },
>(router: R): void {
  const invalidate = router.invalidate
  router.invalidate = ((...args: Parameters<R['invalidate']>) => {
    expireRouteContext()
    return invalidate(...args)
  }) as R['invalidate']
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') expireRouteContext()
  })
}
