/**
 * A paused custom domain, as the rest of a request or job reads it.
 *
 * `config.baseUrl` is read synchronously at ~56 call sites (email links, the
 * widget SDK's `__QUACKBACK_URL__`, sitemaps, OAuth callbacks), and routing and
 * links read the section map synchronously, so a decision that needs an async
 * read (a paused custom domain) is made once, up front, and carried on the
 * request's AsyncLocalStorage store for the rest of the work. It holds:
 *  - the origin `config.baseUrl` answers with, when the configured origin is
 *    itself a paused custom hostname;
 *  - the paused hostnames, which links and routing never send anyone to.
 *
 * It is keyed to the workspace it was decided for, so a store that is copied
 * into another workspace's scope never answers for it.
 */
import { getLogContext, runWithLogContext } from '@/lib/server/log-context'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

const OVERRIDE_KEY = Symbol.for('quackback.baseUrlOverride')

/** What a paused custom domain changes for the work that reads it. */
export interface PausedCustomDomainView {
  /** The origin `config.baseUrl` answers with, or null to keep the configured one. */
  origin: string | null
  /** Lower-case hostnames that links and routing never name while paused. */
  hostnames: readonly string[]
}

interface HeldView extends PausedCustomDomainView {
  workspaceKey: string | null
}

const NO_HOSTNAMES: ReadonlySet<string> = new Set()

function currentWorkspaceKey(): string | null {
  return getCurrentWorkspace()?.workspaceKey ?? null
}

function held(): HeldView | null {
  const store = getLogContext() as Record<PropertyKey, unknown> | undefined
  const value = store?.[OVERRIDE_KEY] as HeldView | undefined
  if (!value || value.workspaceKey !== currentWorkspaceKey()) return null
  return value
}

function heldFor(view: PausedCustomDomainView): HeldView {
  return { workspaceKey: currentWorkspaceKey(), origin: view.origin, hostnames: view.hostnames }
}

/** The overriding origin for the current workspace, or null. */
export function baseUrlOverride(): string | null {
  return held()?.origin ?? null
}

/** The current workspace's paused hostnames: empty unless its custom domain is paused. */
export function pausedHostnames(): ReadonlySet<string> {
  const hostnames = held()?.hostnames
  return hostnames?.length ? new Set(hostnames) : NO_HOSTNAMES
}

/**
 * Apply a paused custom domain to the rest of this request.
 *
 * Set on the request's own store in place, so it holds for everything the
 * request still renders (a streamed document included) and log fields added
 * later still reach the access log. The store dies with the request.
 */
export function setRequestPausedCustomDomain(view: PausedCustomDomainView): void {
  const store = getLogContext() as Record<PropertyKey, unknown> | undefined
  if (!store) return
  store[OVERRIDE_KEY] = heldFor(view)
}

/** Make `config.baseUrl` answer `origin` for the rest of this request. */
export function setRequestBaseUrlOverride(origin: string): void {
  setRequestPausedCustomDomain({ origin, hostnames: [] })
}

/**
 * Run `fn` with a paused custom domain applied, in a store of its own, for
 * background work whose store may outlive this one piece of it.
 */
export function runWithPausedCustomDomain<T>(view: PausedCustomDomainView, fn: () => T): T {
  const parent = getLogContext() as Record<PropertyKey, unknown> | undefined
  const child: Record<PropertyKey, unknown> = { ...(parent ?? {}) }
  child[OVERRIDE_KEY] = heldFor(view)
  return runWithLogContext(child as never, fn)
}

/** Run `fn` with `config.baseUrl` answering `origin`, in a store of its own. */
export function runWithBaseUrlOverride<T>(origin: string, fn: () => T): T {
  return runWithPausedCustomDomain({ origin, hostnames: [] }, fn)
}

/**
 * Run `fn` with nothing paused applied: `config.baseUrl` answers the
 * configured origin. For anything built once and cached past the request that
 * builds it (the auth instance), so a paused custom domain never leaks into it.
 */
export function runWithoutBaseUrlOverride<T>(fn: () => T): T {
  const parent = getLogContext() as Record<PropertyKey, unknown> | undefined
  if (!parent?.[OVERRIDE_KEY]) return fn()
  const child: Record<PropertyKey, unknown> = { ...parent }
  delete child[OVERRIDE_KEY]
  return runWithLogContext(child as never, fn)
}
