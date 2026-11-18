/**
 * A per-request override of the origin `config.baseUrl` answers with.
 *
 * `config.baseUrl` is read synchronously at ~56 call sites (email links, the
 * widget SDK's `__QUACKBACK_URL__`, sitemaps, OAuth callbacks), so a decision
 * that needs an async read (a paused custom domain) is made once, up front, and
 * carried on the request's AsyncLocalStorage store for the rest of the work.
 *
 * The override is keyed to the workspace it was decided for, so a store that
 * is copied into another workspace's scope never answers for it.
 */
import { getLogContext, runWithLogContext } from '@/lib/server/log-context'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

const OVERRIDE_KEY = Symbol.for('quackback.baseUrlOverride')

interface BaseUrlOverride {
  workspaceKey: string | null
  origin: string
}

function currentWorkspaceKey(): string | null {
  return getCurrentWorkspace()?.workspaceKey ?? null
}

/** The overriding origin for the current workspace, or null. */
export function baseUrlOverride(): string | null {
  const store = getLogContext() as Record<PropertyKey, unknown> | undefined
  const held = store?.[OVERRIDE_KEY] as BaseUrlOverride | undefined
  if (!held || held.workspaceKey !== currentWorkspaceKey()) return null
  return held.origin
}

/**
 * Make `config.baseUrl` answer `origin` for the rest of this request.
 *
 * Set on the request's own store in place, so it holds for everything the
 * request still renders (a streamed document included) and log fields added
 * later still reach the access log. The store dies with the request.
 */
export function setRequestBaseUrlOverride(origin: string): void {
  const store = getLogContext() as Record<PropertyKey, unknown> | undefined
  if (!store) return
  store[OVERRIDE_KEY] = { workspaceKey: currentWorkspaceKey(), origin } satisfies BaseUrlOverride
}

/**
 * Run `fn` with `config.baseUrl` answering `origin`, in a store of its own, for
 * background work whose store may outlive this one piece of it.
 */
export function runWithBaseUrlOverride<T>(origin: string, fn: () => T): T {
  const parent = getLogContext() as Record<PropertyKey, unknown> | undefined
  const child: Record<PropertyKey, unknown> = { ...(parent ?? {}) }
  child[OVERRIDE_KEY] = { workspaceKey: currentWorkspaceKey(), origin } satisfies BaseUrlOverride
  return runWithLogContext(child as never, fn)
}
