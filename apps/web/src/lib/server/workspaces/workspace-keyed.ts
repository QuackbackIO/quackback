/**
 * Making process-lifetime caches workspace-safe.
 *
 * SAAS-HOSTING-STACK.md §4 counts ~20 module-scope caches that are correct for
 * one process serving one workspace and become cross-workspace capabilities the moment
 * one process serves several: a magic-link stash keyed only by lowercased email,
 * an S3 client built from global config, HKDF keys keyed by purpose alone, a
 * daily visitor-hash salt, a built better-auth instance.
 *
 * The fix is always the same shape, so it lives here once: prefix the key with
 * the active workspace. Two helpers, and the choice between them is not stylistic.
 *
 * - {@link workspaceScopedKey} is for keys that leave the process — Redis keys, channel
 *   names, lock names. Those must be *namespaced*, and the namespace has to be
 *   stable and greppable because it also has to be reasoned about during an
 *   incident.
 * - {@link WorkspaceKeyedCache} is for in-heap maps. It also bounds itself, which
 *   the raw `Map`s it replaces do not: an unbounded per-workspace map in a pooled
 *   process is a slow leak with a workspace-count multiplier.
 *
 * ## The single-workspace identity
 *
 * With no workspace scope the prefix is `_` — one stable namespace, not a random
 * or absent one. That keeps self-hosted behaviour byte-identical (every key
 * lands in the same namespace it always did, modulo the constant prefix) and
 * keeps the pooled and single code paths the same code rather than two branches
 * that can drift.
 *
 * ## What this does NOT do
 *
 * It does not make a cache *correct*; it makes it *separated*. A cache holding
 * something that must not outlive a request still needs a request-scoped home
 * (`functions/auth-request-cache.ts`), and a cache holding a secret still needs
 * the secret resolved per workspace. Prefixing a key that was already wrong just
 * makes it wrong per workspace.
 */
import { getCurrentWorkspace } from './workspace-context'

/** Namespace for a process with no workspace scope. Stable, never absent. */
export const SINGLE_WORKSPACE_NAMESPACE = '_'

/** The active workspace's id, or the single-workspace namespace. */
export function currentWorkspaceNamespace(): string {
  return getCurrentWorkspace()?.workspaceKey ?? SINGLE_WORKSPACE_NAMESPACE
}

/**
 * Namespace an external key (Redis, a channel, a lock name) by workspace.
 *
 * `workspaceScopedKey('settings:workspace')` → `w:<workspaceKey>:settings:workspace`.
 *
 * The `w:` marker is deliberate: a key in a shared Redis has to be readable by
 * a human during an incident, and "which workspace is this" must not require
 * knowing the id format.
 *
 * The marker moved from `t:` with the workspace remodel, which abandons any key
 * an older process left behind. Safe because it is affordable, not because it
 * is invisible: everything reachable through this helper is a cache, a
 * rate-limit bucket or a short-lived stash, all of which regenerate. A value
 * that could not survive losing its namespace does not belong behind a
 * process-lifetime key in the first place.
 */
export function workspaceScopedKey(key: string): string {
  return `w:${currentWorkspaceNamespace()}:${key}`
}

/**
 * A bounded, workspace-partitioned map.
 *
 * Bounded because the maps this replaces are not: `magicLinkStash` and friends
 * grow with traffic and were only ever survivable because a process saw one
 * workspace's traffic. Eviction is oldest-insertion-first, which is the right
 * policy for short-lived credential stashes and harmless for config memos.
 */
export class WorkspaceKeyedCache<V> {
  private readonly entries = new Map<string, V>()

  constructor(private readonly maxEntries = 5_000) {}

  /**
   * The namespace/key separator, named once.
   *
   * It was spelled inline in three methods, and two of them said `\u0000` while
   * `workspaceKeys()` said a space -- so `workspaceKeys()` matched nothing, the
   * keyed prune silently stopped pruning, and the test covering
   * it asserted a negative that held either way. A literal three methods must
   * agree on is a drift waiting to happen; there is now one spelling, and
   * `prefix()` is the only thing that builds from it.
   *
   * NUL because it cannot occur in a workspace id or in any key composed here, so
   * no two (namespace, key) pairs can compose to the same string. Written as an
   * escape rather than embedded as a raw byte: a literal NUL compiles fine but
   * is invisible in a diff and eaten by most greps.
   */
  private static readonly SEPARATOR = '\u0000'

  /** Everything before the key, for the active workspace. */
  private prefix(): string {
    return `${currentWorkspaceNamespace()}${WorkspaceKeyedCache.SEPARATOR}`
  }

  private compose(key: string): string {
    return `${this.prefix()}${key}`
  }

  get(key: string): V | undefined {
    return this.entries.get(this.compose(key))
  }

  has(key: string): boolean {
    return this.entries.has(this.compose(key))
  }

  set(key: string, value: V): void {
    const composed = this.compose(key)
    this.entries.delete(composed)
    this.entries.set(composed, value)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  delete(key: string): boolean {
    return this.entries.delete(this.compose(key))
  }

  /** Resolve once per workspace per key, memoising the result. */
  memo(key: string, factory: () => V): V {
    const existing = this.get(key)
    if (existing !== undefined) return existing
    const created = factory()
    this.set(key, created)
    return created
  }

  /**
   * The active workspace's keys, with the namespace stripped.
   *
   * Exists so a cache that has to *prune* itself (a retry ledger keyed by row
   * id, say) can enumerate its own entries without enumerating the fleet's.
   * Iterating `entries` directly is what a caller would otherwise reach for,
   * and that walks every workspace.
   */
  workspaceKeys(): string[] {
    const prefix = this.prefix()
    const out: string[] = []
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length))
    }
    return out
  }

  /** Forget everything for the active workspace. */
  clearWorkspace(): void {
    const prefix = this.prefix()
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
