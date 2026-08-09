/**
 * The outbox relay tier — one always-warm loop per tenant, on direct
 * (session-mode) connections, physically separate from the pooled web tier.
 *
 * `SAAS-HOSTING-STACK.md` §7.3. `relay.ts` still owns what a drain *is*
 * (ordering, the depth ceiling, the strict-resolution budget, at-least-once);
 * this file owns the connections, the scopes, the leader lease and the doorbell.
 *
 * ## Why the connection has to be direct, and why the obvious check lies
 *
 * `LISTEN` needs a session-mode connection. Measured on Neon twice with two
 * instruments: **through the transaction-mode pooler a NOTIFY never arrives, at
 * any concurrency — including a single client.** And `pg_listening_channels()`
 * is not merely a false green, it is *inverted*: it reports the registration on
 * the pooled connection that delivers nothing and not on the direct one that
 * does, because `postgres.js` puts `LISTEN` on its own connection which the
 * pooler may not share with the query asking the question.
 *
 * So this tier never asks the catalogue whether it is registered. It sends a
 * NOTIFY from a second connection and waits for it (`wake.ts`'s `verify()`), and
 * says so loudly when nothing arrives.
 *
 * ## Why it builds its own pools rather than using the request pool cache
 *
 * Three reasons, and the first is the architectural one:
 *
 * 1. the pool cache terminates at the **pooled** endpoint, which is the right
 *    answer for a request and the wrong one for a tier that holds a `LISTEN`
 *    and a long-lived lease;
 * 2. the cache is an LRU sized for request traffic and evicts on idleness —
 *    exactly what an always-warm tier must not have done to it;
 * 3. §6's corollary: this tier holds its connections open **by design**, so it
 *    must never share a compute with tenants you expect to suspend. Making that
 *    a separate pool makes it a separate, countable thing.
 *
 * What it does *not* do is re-implement the §3 fingerprint assertion. It calls
 * `verifyTenantDatabase`, the same function the request path uses, so a
 * mis-pointed record is refused on this tier for the same reason and with the
 * same message. A second copy of a fail-closed check is a second copy that can
 * drift open.
 *
 * ## Single-tenant installs
 *
 * One loop, no tenant scope, `DATABASE_URL` — which for a self-hosted install
 * already is a direct session-mode connection. The lease replaces the advisory
 * lock there too, so a self-hoster running two worker replicas gets the same
 * one-drainer guarantee with one fewer dedicated connection than before.
 */
import { config } from '@/lib/server/config'
import { db as ambientDb, type Database } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { openWakeListener, type WakeListener } from '@/lib/server/jobs/wake'
import { warnIfPooled } from './direct-session'
import { listActiveTenants, type TenantDescriptor } from '@/lib/server/tenancy/registry'
import { openTenantDirectPool, resolveTenantPassword } from '@/lib/server/tenancy/pool-cache'
import { runWithTenantScope, type TenantScope } from '@/lib/server/tenancy/tenant-context'
import { drainOnce, type DrainResult } from './relay'
import {
  claimRelayLease,
  isMissingRelayLeaderTable,
  releaseRelayLease,
  renewRelayLease,
  relayOwnerId,
  type RelayLease,
} from './relay-leader'
import { registerAllResolvers } from './resolvers'

const log = logger.child({ component: 'outbox-relay-tier' })

/**
 * The channel the `emit()` path already NOTIFYs on commit. Unchanged from the
 * single-database relay — the channel is per *database*, and each tenant has its
 * own, so the name carries no tenant and needs none.
 */
export const OUTBOX_WAKE_CHANNEL = 'outbox_wake'

/** Sentinel tenant id for a single-tenant install. Never a real tenant id. */
const SINGLE = '__single__'

/** How often the pooled tier re-reads the tenant list. */
const TENANT_REFRESH_MS = 60_000

export interface RelayTierConfig {
  /** Poll fallback. The correctness floor when a NOTIFY is lost. */
  pollIntervalMs: number
  /** How long a leadership lease is held before another replica may take it. */
  leaseTtlMs: number
  /** How often a follower re-asks for the lease. */
  followerRetryMs: number
  /** Rows per drain pass. */
  batchSize: number
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Read from `process.env` directly rather than through the zod config, matching
 * `queue/role.ts` and the job tier: these must work in any context, including a
 * relay process that has not loaded the full application config.
 */
export function relayTierConfig(): RelayTierConfig {
  return {
    pollIntervalMs: envInt('RELAY_POLL_INTERVAL_MS', 1_000),
    leaseTtlMs: envInt('RELAY_LEASE_TTL_MS', 30_000),
    followerRetryMs: envInt('RELAY_FOLLOWER_RETRY_MS', 5_000),
    batchSize: envInt('RELAY_BATCH_SIZE', 100),
  }
}

/** Escape hatch for measuring the poll floor. Never set in production. */
export function relayWakeDisabled(): boolean {
  return process.env.RELAY_WAKE_DISABLED === '1'
}

export interface RelayLoopStats {
  /** Loop iterations that reached a drain (i.e. this replica held the lease). */
  passes: number
  drained: number
  enqueued: number
  skipped: number
  failed: number
  /** NOTIFYs received on this tenant's channel. */
  wakes: number
  /** True while this replica holds the lease for this tenant. */
  leader: boolean
  /** Leadership epoch, so a takeover is visible rather than inferred. */
  fence: string | null
  /** Times this replica lost the lease while it believed it held it. */
  leaseLosses: number
  /**
   * End-to-end: the relay's clock at publish minus the emitter's `occurred_at`,
   * for the most recent row published. NOT a harness timer, and not the gap
   * between the NOTIFY and the drain — an event whose doorbell was lost is
   * measured on the same scale as one whose doorbell fired.
   */
  lastEventLagMs: number | null
  /** Bounded ring of the same measurement, for percentiles. */
  lagSamplesMs: number[]
  /**
   * The relay's own component of that latency: notify received → the drain that
   * answered it finished. Reported separately because the end-to-end number
   * above also contains the emitter's commit round trips, and a reader comparing
   * two deployments needs to know which half moved.
   */
  wakeToDrainMs: number[]
  /** Set when this tenant's database predates the relay-leader migration. */
  schemaMissing: boolean
  /** Set when the boot doorbell probe round-tripped a real NOTIFY. */
  doorbellVerified: boolean | null
}

interface RelayLoop {
  tenantId: string
  stop(): Promise<void>
  ring(): void
}

/** How many latency samples each tenant keeps. Bounded so a busy tenant cannot grow it. */
const LAG_RING = 200

const loops = new Map<string, RelayLoop>()
const stats = new Map<string, RelayLoopStats>()
let running = false
let refreshTimer: ReturnType<typeof setInterval> | null = null

function emptyStats(): RelayLoopStats {
  return {
    passes: 0,
    drained: 0,
    enqueued: 0,
    skipped: 0,
    failed: 0,
    wakes: 0,
    leader: false,
    fence: null,
    leaseLosses: 0,
    lastEventLagMs: null,
    lagSamplesMs: [],
    wakeToDrainMs: [],
    schemaMissing: false,
    doorbellVerified: null,
  }
}

/**
 * Prove a freshly attached doorbell actually delivers, and say so loudly if it
 * does not.
 *
 * The failure §7.3 measured is silent: a pooled DSN accepts the `LISTEN` and
 * then delivers nothing, while `pg_listening_channels()` reports the
 * registration as present the whole time. One NOTIFY round trip per tenant at
 * boot is the difference between "slower than you think" and "you know why".
 *
 * Deliberately not awaited: the relay is correct on the poll interval alone, so
 * a slow probe must not delay boot.
 */
function verifyDoorbell(
  listener: WakeListener,
  label: string,
  s: RelayLoopStats,
  live: { stopped: boolean }
): void {
  void listener
    .verify()
    .then((ok) => {
      // A listener closed while its probe was still in flight reports a false
      // RED, which is the one failure mode this probe has. Observed in a harness
      // that stopped and restarted the tier: the previous run's 5s timeout fired
      // during the next run and named a tenant whose doorbell was fine.
      if (live.stopped) return
      s.doorbellVerified = ok
      if (ok) return
      log.error(
        { tenant: label, channel: OUTBOX_WAKE_CHANNEL },
        'outbox wake doorbell attached but delivered nothing — this tenant is draining on the ' +
          'poll interval alone. A pooled DSN produces exactly this: the registration is accepted ' +
          'and nothing is ever delivered. The listener needs the direct endpoint.'
      )
    })
    .catch((err) => {
      if (live.stopped) return
      log.warn({ err, tenant: label }, 'could not verify the outbox wake doorbell')
    })
}

/**
 * One tenant's loop: take or renew the lease → drain → wait for a wake or the
 * poll interval.
 *
 * The wait is a race between the doorbell and the poll. If the doorbell is lost
 * — a dropped connection, a pooled DSN, a NOTIFY that raced the LISTEN — the
 * poll still fires, so a lost wake costs latency and never correctness.
 */
function startLoop(opts: {
  tenantId: string
  config: RelayTierConfig
  listener: WakeListener | null
  /** Shared with the doorbell probe so a probe outliving `stop()` stays quiet. */
  live: { stopped: boolean }
  /** The tenant's own database. Direct endpoint under pooled tenancy. */
  db: Database
  /** Runs the body inside this tenant's scope (identity under single tenancy). */
  scoped: <T>(body: () => Promise<T>) => Promise<T>
  /** Closes the pool this loop owns, if it owns one. */
  closePool?: () => Promise<void>
}): RelayLoop {
  const s = stats.get(opts.tenantId) ?? emptyStats()
  stats.set(opts.tenantId, s)

  let stopped = false
  let wakeResolve: (() => void) | null = null
  let lease: RelayLease | null = null
  let wakeAt: number | null = null

  const ring = () => {
    if (wakeAt === null) wakeAt = Date.now()
    s.wakes += 1
    const resolve = wakeResolve
    wakeResolve = null
    resolve?.()
  }

  const waitForWork = (ms: number) =>
    new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        wakeResolve = null
        resolve()
      }
      const timer = setTimeout(done, ms)
      timer.unref?.()
      wakeResolve = done
    })

  const record = (res: DrainResult) => {
    s.passes += 1
    s.drained += res.drained
    s.enqueued += res.enqueued
    s.skipped += res.skipped
    s.failed += res.failed
    for (const lag of res.lagMsSamples) {
      s.lastEventLagMs = lag
      s.lagSamplesMs.push(lag)
      if (s.lagSamplesMs.length > LAG_RING) s.lagSamplesMs.shift()
    }
  }

  const loop = async () => {
    while (running && !stopped) {
      let waitMs = opts.config.pollIntervalMs
      try {
        const next = lease
          ? await opts.scoped(() =>
              renewRelayLease(opts.db, lease as RelayLease, opts.config.leaseTtlMs)
            )
          : await opts.scoped(() => claimRelayLease(opts.db, opts.config.leaseTtlMs))

        if (!next) {
          if (lease) {
            s.leaseLosses += 1
            log.error(
              { tenantId: opts.tenantId, fence: s.fence },
              'lost outbox relay leadership while holding it — another replica took over. ' +
                'This means a drain pass outran the lease; nothing is lost (drains are ' +
                'idempotent) but the lease TTL is too short for this tenant.'
            )
          }
          lease = null
          s.leader = false
          s.fence = null
          // A follower must not drain. Re-ask on its own cadence rather than the
          // poll interval: it is asking about leadership, not about work.
          await waitForWork(opts.config.followerRetryMs)
          continue
        }

        if (!lease || next.fence !== lease.fence) {
          log.info(
            { tenantId: opts.tenantId, fence: next.fence, owner: next.owner },
            'acquired outbox relay leadership'
          )
        }
        lease = next
        s.leader = true
        s.fence = next.fence
        s.schemaMissing = false

        const wokenAt = wakeAt
        wakeAt = null
        const res = await opts.scoped(() => drainOnce({ batchSize: opts.config.batchSize }))
        record(res)
        if (wokenAt !== null && res.drained > 0) {
          s.wakeToDrainMs.push(Date.now() - wokenAt)
          if (s.wakeToDrainMs.length > LAG_RING) s.wakeToDrainMs.shift()
        }

        // A pass that made progress probably has more behind it; go straight
        // round again rather than sleeping. A pass where every remaining row
        // failed must NOT, or a persistently failing row hot-spins the loop.
        if (res.drained > 0 && res.failed < res.drained) continue
      } catch (err) {
        if (isMissingRelayLeaderTable(err)) {
          if (!s.schemaMissing) {
            s.schemaMissing = true
            log.warn(
              { tenantId: opts.tenantId },
              'outbox_relay_leader is absent in this database (migration 0256 not applied); ' +
                'skipping this tenant rather than crash-looping'
            )
          }
          waitMs = Math.max(opts.config.followerRetryMs, opts.config.pollIntervalMs)
        } else {
          log.error({ err, tenantId: opts.tenantId }, 'outbox relay pass failed')
        }
      }
      if (!running || stopped) break
      await waitForWork(waitMs)
    }
  }

  void runWithLogContext(
    { request_id: crypto.randomUUID(), route: 'events:relay-tier', tenant_id: opts.tenantId },
    loop
  ).catch((err) => log.error({ err, tenantId: opts.tenantId }, 'outbox relay loop exited'))

  return {
    tenantId: opts.tenantId,
    ring,
    async stop() {
      stopped = true
      opts.live.stopped = true
      wakeResolve?.()
      if (lease) {
        // Hand over immediately rather than making the next replica wait out the
        // TTL. Best effort: a lease we fail to release simply expires.
        await opts
          .scoped(() => releaseRelayLease(opts.db, lease as RelayLease))
          .catch((err) =>
            log.warn({ err, tenantId: opts.tenantId }, 'failed to release relay lease')
          )
        lease = null
      }
      await opts.listener?.close()
      await opts.closePool?.()
      stats.delete(opts.tenantId)
    },
  }
}

async function openListener(
  directUrl: string,
  label: string,
  s: RelayLoopStats,
  holder: { ring: (() => void) | null },
  live: { stopped: boolean },
  password?: () => Promise<string>
): Promise<WakeListener | null> {
  if (relayWakeDisabled()) {
    log.warn(
      { tenant: label },
      'RELAY_WAKE_DISABLED=1 — no doorbell; the relay drains on the poll interval alone'
    )
    return null
  }
  try {
    const listener = await openWakeListener({
      directUrl,
      channel: OUTBOX_WAKE_CHANNEL,
      label,
      onWake: () => holder.ring?.(),
      ...(password ? { password } : {}),
    })
    verifyDoorbell(listener, label, s, live)
    return listener
  } catch (err) {
    log.error(
      { err, tenant: label },
      'could not attach the outbox wake listener; this tenant drains on the poll fallback only'
    )
    return null
  }
}

async function startSingleTenantLoop(cfg: RelayTierConfig): Promise<void> {
  const holder: { ring: (() => void) | null } = { ring: null }
  const s = emptyStats()
  stats.set(SINGLE, s)
  const live = { stopped: false }
  const listener = await openListener(config.databaseUrl, SINGLE, s, holder, live)
  const loop = startLoop({
    tenantId: SINGLE,
    config: cfg,
    listener,
    live,
    db: ambientDb,
    scoped: (body) => body(),
  })
  holder.ring = loop.ring
  loops.set(SINGLE, loop)
}

/**
 * Build this tenant's own direct pool, assert it really is that tenant's
 * database, and start its loop.
 *
 * Throws on refusal. The caller catches per tenant — one bad record must not
 * cost the rest of the fleet its relay.
 */
async function startTenantLoop(tenant: TenantDescriptor, cfg: RelayTierConfig): Promise<void> {
  // Named before the connection is opened, so the likeliest misconfiguration is
  // reported against the field that carries it rather than as a doorbell that
  // quietly never rings. The NOTIFY round trip below is still the authority.
  warnIfPooled(tenant.database.directUrl, { tenantId: tenant.tenantId, use: 'the outbox relay' })

  // One connection for the drain and the lease. The doorbell opens its own, so a
  // tenant costs this tier exactly two sockets and both are session-mode.
  // `openTenantDirectPool` runs the same §3 fingerprint assertion the request
  // path runs, so a mis-pointed record is refused here for the same reason and
  // with the same message.
  const pool = await openTenantDirectPool(tenant)
  const scope: TenantScope = {
    tenant,
    db: pool.db,
    sql: pool.sql,
    secrets: pool.secrets,
    origin: 'relay',
  }

  const holder: { ring: (() => void) | null } = { ring: null }
  const s = emptyStats()
  stats.set(tenant.tenantId, s)
  const live = { stopped: false }
  const listener = await openListener(
    // Direct, never pooled. Through a transaction pooler the registration is
    // accepted and nothing is ever delivered — see jobs/wake.ts.
    tenant.database.directUrl,
    tenant.tenantId,
    s,
    holder,
    live,
    () => resolveTenantPassword(tenant)
  )

  const loop = startLoop({
    tenantId: tenant.tenantId,
    config: cfg,
    listener,
    live,
    db: pool.db,
    scoped: (body) => runWithTenantScope(scope, body),
    closePool: () => pool.close(),
  })
  holder.ring = loop.ring
  loops.set(tenant.tenantId, loop)
}

/**
 * Reconcile the running loops against the active tenant list.
 *
 * Every failure is per tenant. A record the registry refuses, a database whose
 * fingerprint does not match, an unresolvable credential — each costs that
 * tenant its relay and nothing else. A pass that threw on the first bad record
 * would turn one wrong row in the control plane into a fleet-wide eventing
 * outage, which is a strictly worse failure than the one it is reacting to.
 */
async function refreshTenantLoops(cfg: RelayTierConfig): Promise<void> {
  const { tenants, refused } = await listActiveTenants()
  if (refused.length > 0) {
    log.error(
      { refused, active: tenants.length },
      'outbox relay tier skipping tenants with invalid registry records — the rest of the fleet continues'
    )
  }
  const wanted = new Set(tenants.map((t) => t.tenantId))

  for (const [tenantId, loop] of loops) {
    if (wanted.has(tenantId)) continue
    log.info({ tenantId }, 'tenant left the active set — stopping its relay loop')
    await loop.stop()
    loops.delete(tenantId)
  }

  let started = 0
  let refusedHere = 0
  for (const tenant of tenants) {
    if (loops.has(tenant.tenantId)) continue
    try {
      await startTenantLoop(tenant, cfg)
      started += 1
    } catch (err) {
      refusedHere += 1
      log.error(
        { err, tenantId: tenant.tenantId },
        'outbox relay tier refused this tenant — continuing with the rest of the fleet'
      )
    }
  }
  if (started > 0 || refusedHere > 0) {
    log.info(
      { started, refused: refusedHere + refused.length, live: loops.size },
      'outbox relay tier tenant set reconciled'
    )
  }
}

/**
 * Start the relay tier. Worker-role only, so calling it on a web replica is a
 * no-op — the same gate the job tier uses.
 */
export async function startRelayTier(): Promise<void> {
  if (running) return
  if (!shouldRunWorkers()) {
    log.info('QUACKBACK_ROLE=web — outbox relay tier not started')
    return
  }
  // Every sink resolver must be registered before anything drains, or a row
  // resolves to fewer targets than it has.
  registerAllResolvers()
  running = true
  const cfg = relayTierConfig()

  if (!config.isPooledTenancy) {
    await startSingleTenantLoop(cfg)
    log.info(
      { poll_interval_ms: cfg.pollIntervalMs, owner: relayOwnerId() },
      'outbox relay tier started (single tenant)'
    )
    return
  }

  await refreshTenantLoops(cfg)
  refreshTimer = setInterval(() => {
    void refreshTenantLoops(cfg).catch((err) =>
      log.error({ err }, 'outbox relay tier tenant refresh failed')
    )
  }, TENANT_REFRESH_MS)
  refreshTimer.unref?.()
  log.info(
    { tenants: loops.size, poll_interval_ms: cfg.pollIntervalMs, owner: relayOwnerId() },
    'outbox relay tier started (pooled)'
  )
}

export async function stopRelayTier(): Promise<void> {
  running = false
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  const all = [...loops.values()]
  loops.clear()
  await Promise.allSettled(all.map((l) => l.stop()))
}

export interface RelayTierStatus {
  running: boolean
  owner: string
  tenants: Array<{ tenantId: string } & RelayLoopStats>
}

export function getRelayTierStatus(): RelayTierStatus {
  return {
    running,
    owner: relayOwnerId(),
    tenants: [...stats.entries()].map(([tenantId, s]) => ({ tenantId, ...s })),
  }
}
