/**
 * In-process concurrency caps for the SSE stream endpoint (Phase 6 R1).
 *
 * Three bounds now, and the reason for the third is the whole point of this
 * module under pooling:
 *
 * - a **global** cap, a file-descriptor backstop for the single Bun process;
 * - a **per-tenant** cap, so one workspace cannot consume the process's whole
 *   stream budget and leave every other workspace unable to open one;
 * - a **per-IP** cap, counted *within* a tenant, so one client can't monopolize
 *   its own workspace's share.
 *
 * This is a concurrency gauge, not a rate limit — it counts connections open
 * RIGHT NOW, so it lives in-process where the socket lifecycle is authoritative
 * (a shared-store gauge would leak a slot on every process crash). Presence,
 * which is genuine cross-replica state, lives in the database; this backstop is
 * deliberately per-process, matching the FD limit it guards. The client's polling fallback
 * keeps low-priority surfaces working when a stream is refused here.
 *
 * ## Why the global cap stays global, and the per-IP cap does not
 *
 * This cap is a site where "one tenant starves the
 * pod". Both halves of that are true and they want opposite fixes.
 *
 * The **global** number describes the *process* — file descriptors are not
 * partitioned by tenant, and a per-tenant global cap would be a promise the
 * kernel has not made. It is deliberately left shared, and the per-tenant cap
 * below is what stops one workspace reaching it alone.
 *
 * The **per-IP** number describes a *client of a workspace*, and sharing it
 * across tenants is a real cross-tenant effect with no upside: a NAT'd office
 * whose staff use two Quackback workspaces would have the second workspace's
 * streams refused because of the first's, and a single abusive tenant could
 * deny service to every other tenant behind the same corporate egress IP. So it
 * is counted per (tenant, IP).
 */
import { currentTenantNamespace } from '@/lib/server/tenancy/tenant-keyed'

/** How many streams the single process will hold open at once. */
const MAX_CONCURRENT_STREAMS = 500
/**
 * How many of those one workspace may hold. Deliberately well below the global
 * cap: a pooled replica serves many workspaces, and the property that matters
 * is that a workspace which has exhausted its own share cannot make anyone
 * else's stream fail. Single-tenant installs see one workspace, so the global
 * cap remains the binding one for them and nothing changes.
 */
const MAX_STREAMS_PER_TENANT = 100
/** How many concurrent streams one identified client may hold within a
 *  workspace. Generous enough for a NAT'd office (many real visitors behind one
 *  public IP) while stopping a single client from opening hundreds of tabs'
 *  worth of sockets. */
const MAX_STREAMS_PER_IP = 20

export interface StreamSlot {
  /** Whether a slot was granted. When false, `release` is a no-op. */
  ok: boolean
  /** Return the slot to the pool. Idempotent; a no-op when `ok` is false. */
  release: () => void
}

const NOOP_SLOT: StreamSlot = { ok: false, release: () => {} }

export interface StreamLimiterOptions {
  maxGlobal?: number
  maxPerTenant?: number
  maxPerIp?: number
  /**
   * Which tenant a slot belongs to. Defaults to the ambient tenant scope, which
   * resolves to the stable single-tenant namespace when there is none — so a
   * self-hosted install has exactly one bucket and the per-tenant cap is inert
   * against the global one.
   */
  tenantOf?: () => string
}

export function createStreamLimiter(opts: StreamLimiterOptions = {}) {
  const maxGlobal = opts.maxGlobal ?? MAX_CONCURRENT_STREAMS
  const maxPerTenant = opts.maxPerTenant ?? MAX_STREAMS_PER_TENANT
  const maxPerIp = opts.maxPerIp ?? MAX_STREAMS_PER_IP
  const tenantOf = opts.tenantOf ?? currentTenantNamespace
  let open = 0
  const perTenant = new Map<string, number>()
  const perIp = new Map<string, number>()

  const bump = (map: Map<string, number>, key: string, by: number): void => {
    const next = (map.get(key) ?? 0) + by
    if (next <= 0) map.delete(key)
    else map.set(key, next)
  }

  return {
    /**
     * Atomically check all three caps and reserve a slot. Pass the client IP to
     * enforce the per-IP dimension; pass `undefined` for an unidentifiable
     * client (only the global and per-tenant caps apply then, so a shared
     * "unknown" bucket can't false-positive real visitors).
     *
     * The tenant is read once here and captured by the returned `release`, so a
     * slot is always returned to the bucket it was taken from even if the
     * connection outlives the scope that opened it — which an SSE stream does
     * by definition.
     */
    acquire(ip?: string): StreamSlot {
      const tenant = tenantOf()
      // NUL separator, spelled as an escape so it survives a grep, a diff and
      // a copy-paste. It also cannot appear in a tenant id or an IP, so
      // `alpha` + `1.2 3.4` can never compose to the same key as `alpha 1.2` +
      // `3.4`. Same convention as computeVisitorHash's component separator.
      const ipKey = ip === undefined ? undefined : `${tenant}\u0000${ip}`
      const tenantCount = perTenant.get(tenant) ?? 0
      const ipCount = ipKey ? (perIp.get(ipKey) ?? 0) : 0
      if (open >= maxGlobal) return NOOP_SLOT
      if (tenantCount >= maxPerTenant) return NOOP_SLOT
      if (ipKey !== undefined && ipCount >= maxPerIp) return NOOP_SLOT
      open++
      bump(perTenant, tenant, 1)
      if (ipKey !== undefined) bump(perIp, ipKey, 1)
      let released = false
      return {
        ok: true,
        release: () => {
          if (released) return
          released = true
          open = Math.max(0, open - 1)
          bump(perTenant, tenant, -1)
          if (ipKey !== undefined) bump(perIp, ipKey, -1)
        },
      }
    },
    /** Live count of open slots (diagnostics/tests). */
    get openCount() {
      return open
    },
    /** Open slots held by the ambient tenant (diagnostics/tests). */
    tenantOpenCount(tenant: string = tenantOf()) {
      return perTenant.get(tenant) ?? 0
    },
    /** Distinct (tenant, IP) pairs currently holding a slot (leak check). */
    get ipCount() {
      return perIp.size
    },
    /** Distinct tenants currently holding a slot (leak check). */
    get tenantCount() {
      return perTenant.size
    },
  }
}

/** Process-wide singleton used by the stream route. */
export const streamLimiter = createStreamLimiter()
