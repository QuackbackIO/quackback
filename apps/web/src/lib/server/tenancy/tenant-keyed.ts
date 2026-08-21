/**
 * Making process-lifetime caches tenant-safe.
 *
 * The server carries ~20 module-scope caches that are correct for
 * one process serving one tenant and become cross-tenant capabilities the moment
 * one process serves several: a magic-link stash keyed only by lowercased email,
 * an S3 client built from global config, HKDF keys keyed by purpose alone, a
 * daily visitor-hash salt, a built better-auth instance.
 *
 * The fix is always the same shape, so it lives here once: prefix the key with
 * the active tenant. Two helpers, and the choice between them is not stylistic.
 *
 * - {@link tenantKey} is for keys that leave the process — shared-store keys,
 *   channel names, lock names. Those must be *namespaced*, and the namespace has to be
 *   stable and greppable because it also has to be reasoned about during an
 *   incident.
 * - {@link TenantKeyedCache} is for in-heap maps. It also bounds itself, which
 *   the raw `Map`s it replaces do not: an unbounded per-tenant map in a pooled
 *   process is a slow leak with a tenant-count multiplier.
 *
 * ## The single-tenant identity
 *
 * With no tenant scope the prefix is `_` — one stable namespace, not a random
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
 * the secret resolved per tenant. Prefixing a key that was already wrong just
 * makes it wrong per tenant.
 */
import { getCurrentTenant } from './tenant-context'

/** Namespace for a process with no tenant scope. Stable, never absent. */
export const SINGLE_TENANT_NAMESPACE = '_'

/** The active tenant's id, or the single-tenant namespace. */
export function currentTenantNamespace(): string {
  return getCurrentTenant()?.tenantId ?? SINGLE_TENANT_NAMESPACE
}

/**
 * A bounded, tenant-partitioned map.
 *
 * Bounded because the maps this replaces are not: `magicLinkStash` and friends
 * grow with traffic and were only ever survivable because a process saw one
 * tenant's traffic. Eviction is oldest-insertion-first, which is the right
 * policy for short-lived credential stashes and harmless for config memos.
 */
export class TenantKeyedCache<V> {
  private readonly entries = new Map<string, V>()

  constructor(private readonly maxEntries = 5_000) {}

  /**
   * The namespace/key separator, named once.
   *
   * It was spelled inline in several methods. A literal they must agree on
   * is a drift waiting to happen; there is now one spelling, and `prefix()`
   * is the only thing that builds from it.
   *
   * NUL because it cannot occur in a tenant id or in any key composed here, so
   * no two (namespace, key) pairs can compose to the same string. Written as an
   * escape rather than embedded as a raw byte: a literal NUL compiles fine but
   * is invisible in a diff and eaten by most greps.
   */
  private static readonly SEPARATOR = '\u0000'

  /** Everything before the key, for the active tenant. */
  private prefix(): string {
    return `${currentTenantNamespace()}${TenantKeyedCache.SEPARATOR}`
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

  /** Resolve once per tenant per key, memoising the result. */
  memo(key: string, factory: () => V): V {
    const existing = this.get(key)
    if (existing !== undefined) return existing
    const created = factory()
    this.set(key, created)
    return created
  }

  /**
   * The active tenant's keys, with the namespace stripped.
   *
   * Exists so a cache that has to *prune* itself (a retry ledger keyed by row
   * id, say) can enumerate its own entries without enumerating the fleet's.
   * Iterating `entries` directly is what a caller would otherwise reach for,
   * and that walks every tenant.
   */
  /** Forget everything for the active tenant. */
  clearTenant(): void {
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
