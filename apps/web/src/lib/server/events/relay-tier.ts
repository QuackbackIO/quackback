/**
 * The outbox relay tier — one always-warm loop per workspace, on direct
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
 *    must never share a compute with workspaces you expect to suspend. Making that
 *    a separate pool makes it a separate, countable thing.
 *
 * ## "By design" is no longer a licence to hold them forever
 *
 * That third reason was the expensive one. Measured on a four-workspace fleet, this
 * tier's two sockets per workspace plus its 1s poll held every compute at 45–70%
 * active while draining nothing; `pool-cache.ts` had already named it as the
 * reason its own eviction could not deliver the cost model.
 *
 * So the pool, the doorbell and the leadership lease are all taken at attach and
 * given back after `TENANT_IDLE_DETACH_MS` of no drained rows and no outside
 * activity — `workspaces/idle.ts` owns that policy. The lease goes back too rather
 * than being left to expire: a detached replica that still held it would keep
 * every other replica out for the lease TTL while doing nothing itself.
 *
 * A detached workspace is one whose doorbell is *known* to be absent, which the
 * poll floor already covers. What changes is how long a lost NOTIFY costs, and
 * that is bounded by the rescan interval rather than by the poll.
 *
 * What it does *not* do is re-implement the §3 fingerprint assertion. It calls
 * `verifyWorkspaceDatabase`, the same function the request path uses, so a
 * mis-pointed record is refused on this tier for the same reason and with the
 * same message. A second copy of a fail-closed check is a second copy that can
 * drift open.
 *
 * ## Single-workspace installs
 *
 * One loop, no workspace scope, `DATABASE_URL` — which for a self-hosted install
 * already is a direct session-mode connection. The lease replaces the advisory
 * lock there too, so a self-hoster running two worker replicas gets the same
 * one-drainer guarantee with one fewer dedicated connection than before.
 */
import { config } from '@/lib/server/config'
import { db as ambientDb, type Database } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'
import { shouldRunWorkers } from '@/lib/server/process-role'
import { openWakeListener, type WakeListener } from '@/lib/server/jobs/wake'
import { warnIfPooled } from './direct-session'
import { listActiveWorkspaces, type WorkspaceDescriptor } from '@/lib/server/workspaces/registry'
import {
  openWorkspaceDirectPool,
  resolveWorkspacePassword,
} from '@/lib/server/workspaces/pool-cache'
import {
  CONTROL_FLEET_RESCAN_KEY,
  idleDetachDisabled,
  nextRescanAt,
  onWorkspaceActivity,
  workspaceIdlePolicy,
  type ReattachReason,
  type WorkspaceIdlePolicy,
} from '@/lib/server/workspaces/idle'
import {
  isWorkspaceQuarantined,
  noteWorkspaceRefusal,
  noteWorkspaceServed,
  quarantineRetryAt,
  refusalCode,
  reportQuarantine,
} from '@/lib/server/workspaces/quarantine'
import {
  createWorkspaceScope,
  runWithWorkspaceScope,
} from '@/lib/server/workspaces/workspace-context'
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
 * single-database relay — the channel is per *database*, and each workspace has its
 * own, so the name carries no workspace and needs none.
 */
export const OUTBOX_WAKE_CHANNEL = 'outbox_wake'

/** Sentinel workspace id for a single-workspace install. Never a real workspace id. */
const SINGLE = '__single__'

/**
 * How often the pooled tier *considers* a workspace-list re-read.
 *
 * The timer always fires on this interval. The read itself is skipped while
 * every loop is detached and the shared rescan grid is not yet due. See
 * `scheduleWorkspaceRefresh`.
 */
const WORKSPACE_REFRESH_MS = 60_000

export interface RelayTierConfig {
  /** Poll fallback. The correctness floor when a NOTIFY is lost. */
  pollIntervalMs: number
  /** How long a leadership lease is held before another replica may take it. */
  leaseTtlMs: number
  /**
   * How often the leader writes a renewal.
   *
   * Decoupled from the poll interval, which is what it used to be tied to. The
   * loop polls every second and the lease lasts thirty, so renewing at the top
   * of every iteration wrote **thirty renewals per lease lifetime** — a write
   * per second per workspace, for ever, to hold something that had twenty-nine
   * seconds left on it. That is a write, not a read, so it is the one thing in
   * this tier that could not be made free by the database being awake anyway:
   * every renewal is a WAL record and a page dirtied.
   *
   * A third of the TTL is the smallest safe divisor: two renewals may be lost
   * (a slow pass, a hiccup) before the lease is at risk, and the leader still
   * discovers a takeover within a third of the TTL rather than instantly. The
   * cost of discovering late is nil — a drain is idempotent, which is why
   * `relay.ts` can say a lost lease loses nothing.
   */
  leaseRenewIntervalMs: number
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
 * `process-role.ts` and the job tier: these must work in any context, including a
 * relay process that has not loaded the full application config.
 */
export function relayTierConfig(): RelayTierConfig {
  const leaseTtlMs = envInt('RELAY_LEASE_TTL_MS', 30_000)
  return {
    pollIntervalMs: envInt('RELAY_POLL_INTERVAL_MS', 1_000),
    leaseTtlMs,
    // Derived from the TTL rather than defaulted to a constant, so an operator
    // who shortens the TTL does not silently get a renewal cadence that cannot
    // hold it. Overridable, which is also how the old behaviour is reproduced
    // for a before-and-after measurement.
    leaseRenewIntervalMs: envInt(
      'RELAY_LEASE_RENEW_MS',
      Math.max(1_000, Math.floor(leaseTtlMs / 3))
    ),
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
  /** NOTIFYs received on this workspace's channel. */
  wakes: number
  /** True while this replica holds the lease for this workspace. */
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
  /** Set when this workspace's database predates the relay-leader migration. */
  schemaMissing: boolean
  /** Set when the boot doorbell probe round-tripped a real NOTIFY. */
  doorbellVerified: boolean | null
  /**
   * True while this loop holds any connection to the workspace database.
   *
   * First-class for the same reason `poolsEvicted` is in the pool cache:
   * detaching has no functional symptom. A fleet where every workspace reads
   * `attached: true` forever is a fleet paying for every compute, and nothing
   * else in this process would say so.
   */
  attached: boolean
  detaches: number
  reattaches: number
  lastReattachReason: ReattachReason | null
  /** Set while this workspace is refused and not being retried. */
  refusedCode: string | null
}

interface RelayLoop {
  workspaceKey: string
  stop(): Promise<void>
  ring(): void
  /** Something outside the tiers opened a scope for this workspace. */
  signal(): void
  /** Latest registry view, so a revision change is seen without a restart. */
  observe(workspace: WorkspaceDescriptor): void
  isAttached(): boolean
}

/** How many latency samples each workspace keeps. Bounded so a busy workspace cannot grow it. */
const LAG_RING = 200

const loops = new Map<string, RelayLoop>()
const stats = new Map<string, RelayLoopStats>()
let running = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeActivity: (() => void) | null = null
/** When this process last read the fleet's workspace list from the control database. */
let lastFleetReadAt = 0

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
    attached: false,
    detaches: 0,
    reattaches: 0,
    lastReattachReason: null,
    refusedCode: null,
  }
}

/**
 * Prove a freshly attached doorbell actually delivers, and say so loudly if it
 * does not.
 *
 * The failure §7.3 measured is silent: a pooled DSN accepts the `LISTEN` and
 * then delivers nothing, while `pg_listening_channels()` reports the
 * registration as present the whole time. One NOTIFY round trip per workspace at
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
      // during the next run and named a workspace whose doorbell was fine.
      if (live.stopped) return
      s.doorbellVerified = ok
      if (ok) return
      log.error(
        { workspace: label, channel: OUTBOX_WAKE_CHANNEL },
        'outbox wake doorbell attached but delivered nothing — this workspace is draining on the ' +
          'poll interval alone. A pooled DSN produces exactly this: the registration is accepted ' +
          'and nothing is ever delivered. The listener needs the direct endpoint.'
      )
    })
    .catch((err) => {
      if (live.stopped) return
      log.warn({ err, workspace: label }, 'could not verify the outbox wake doorbell')
    })
}

/**
 * One workspace's loop: take or renew the lease → drain → wait for a wake or the
 * poll interval.
 *
 * The wait is a race between the doorbell and the poll. If the doorbell is lost
 * — a dropped connection, a pooled DSN, a NOTIFY that raced the LISTEN — the
 * poll still fires, so a lost wake costs latency and never correctness.
 */
interface RelayAttachment {
  /** The workspace's own database. Direct endpoint under pooled workspaces. */
  db: Database
  /** Runs the body inside this workspace's scope (identity under single workspaces). */
  scoped: <T>(body: () => Promise<T>) => Promise<T>
  /** Releases whatever this attachment owns. */
  close(): Promise<void>
}

function startLoop(opts: {
  workspaceKey: string
  config: RelayTierConfig
  idle: WorkspaceIdlePolicy
  /** Latest registry view. Null under single workspaces, where nothing detaches. */
  workspace: WorkspaceDescriptor | null
  /** Builds the workspace's pool and scope. Throws exactly as the request path does. */
  openAttachment: () => Promise<RelayAttachment>
  /** Builds this workspace's doorbell. Null when it could not be attached. */
  openListener: (
    ring: () => void,
    live: { stopped: boolean },
    s: RelayLoopStats
  ) => Promise<WakeListener | null>
  /** Told when the registry view changes, so the next attach uses the new one. */
  onObserve?: (workspace: WorkspaceDescriptor) => void
}): RelayLoop {
  const s = stats.get(opts.workspaceKey) ?? emptyStats()
  stats.set(opts.workspaceKey, s)

  /**
   * Single-workspace installs never detach: one database, `DATABASE_URL`, shared
   * with the request path, and nothing about it is billed for idleness.
   */
  const canDetach = opts.workspace !== null && !idleDetachDisabled(opts.idle)
  let descriptor: WorkspaceDescriptor | null = opts.workspace
  let stopped = false
  let wakeResolve: (() => void) | null = null
  let lease: RelayLease | null = null
  /** When the held lease is next due a renewal write. Zero means "now". */
  let leaseRenewAt = 0
  let wakeAt: number | null = null
  let attachment: RelayAttachment | null = null
  let listener: WakeListener | null = null
  let live = { stopped: false }
  let lastWorkAt = Date.now()
  /** `lastWorkAt` at attach. A mid-pass `signal()` overwrites it. */
  let lastWorkAtOnAttach = lastWorkAt
  let detachedAt = 0
  let signalled = false
  /** Why the current attach happened, including `boot` (stats omit that). */
  let attachReason: ReattachReason = 'boot'
  /** The first drain (or follower miss) after attach is what fast-detach inspects. */
  let firstPassOfAttach = false
  /**
   * A rescan that published nothing: drop the linger. Cleared if a signal
   * arrives while that pass is still running. The first-pass assignment only
   * sets this when `lastWorkAt` is still the attach snapshot.
   */
  let emptyRescanDetach = false

  /**
   * A doorbell arrived.
   *
   * Ends the wait; does not on its own count as work. `outbox_wake` fires on any
   * committed `emit()`, and the drain that follows is what says whether there was
   * anything to publish — a ring whose rows were all skipped is not a reason to
   * stay warm.
   */
  const ring = () => {
    if (wakeAt === null) wakeAt = Date.now()
    s.wakes += 1
    const resolve = wakeResolve
    wakeResolve = null
    resolve?.()
  }

  /**
   * Something outside the tiers opened a scope for this workspace.
   *
   * Ends the wait **only when detached**. This fires on every request, and an
   * attached loop that woke on it would drain once per request instead of once
   * per poll interval — a busy workspace would turn its own traffic into a hot
   * loop against its own outbox. While attached the doorbell already says when
   * there is something to publish; all this needs to do is hold the idle clock
   * open so the tier does not let go underneath live traffic.
   */
  const signal = () => {
    lastWorkAt = Date.now()
    emptyRescanDetach = false
    if (attachment) return
    signalled = true
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

  /**
   * Take hold of the workspace: its own direct pool first, then the doorbell.
   *
   * `openWorkspaceDirectPool` runs the same §3 fingerprint assertion the request
   * path runs, so this is also where a refusal is detected — and detecting it
   * before the doorbell is opened is what stops a workspace this fleet cannot serve
   * from holding a permanent `LISTEN` on its database anyway.
   */
  const attach = async (reason: ReattachReason): Promise<RelayAttachment | null> => {
    if (descriptor && isWorkspaceQuarantined(descriptor)) return null
    try {
      attachment = await opts.openAttachment()
    } catch (err) {
      const code = refusalCode(err)
      s.refusedCode = code
      if (descriptor) {
        const entry = noteWorkspaceRefusal(descriptor, code, errText(err))
        if (entry.disposition === 'transient') {
          log.warn(
            { workspaceKey: opts.workspaceKey, code, attempts: entry.attempts },
            'outbox relay tier could not open this workspace; backing off and retrying'
          )
        }
      } else {
        log.error(
          { err, workspaceKey: opts.workspaceKey },
          'outbox relay tier could not open the database'
        )
      }
      return null
    }

    if (descriptor) noteWorkspaceServed(descriptor.workspaceKey)
    s.refusedCode = null
    live = { stopped: false }
    listener = await opts.openListener(ring, live, s)
    s.attached = true
    lastWorkAt = Date.now()
    lastWorkAtOnAttach = lastWorkAt
    attachReason = reason
    firstPassOfAttach = true
    emptyRescanDetach = false
    if (reason !== 'boot') {
      s.reattaches += 1
      s.lastReattachReason = reason
      log.info(
        { workspaceKey: opts.workspaceKey, reason },
        'outbox relay tier re-attached to workspace'
      )
    }
    return attachment
  }

  /**
   * Give back everything: the lease, the doorbell, the pool.
   *
   * The lease is handed over rather than left to expire, exactly as `stop()`
   * does, and for a sharper reason here: a detached replica holding a lease
   * would lock every other replica out of this workspace's relay for the TTL while
   * doing no draining itself.
   */
  const detach = async (): Promise<void> => {
    const held = attachment
    if (!held) return
    attachment = null
    s.attached = false
    s.detaches += 1
    live.stopped = true

    if (lease) {
      await held
        .scoped(() => releaseRelayLease(held.db, lease as RelayLease))
        .catch((err) =>
          log.warn({ err, workspaceKey: opts.workspaceKey }, 'failed to release relay lease')
        )
      lease = null
      leaseRenewAt = 0
      s.leader = false
      s.fence = null
    }
    const heldListener = listener
    listener = null
    await heldListener?.close().catch(() => {})
    await held.close().catch(() => {})
    detachedAt = Date.now()
    log.info(
      { workspaceKey: opts.workspaceKey, idle_ms: detachedAt - lastWorkAt },
      'outbox relay tier detached from workspace — pool, doorbell and lease released'
    )
  }

  const detachedWaitMs = (): number =>
    Math.max(250, nextRescanAt(Date.now(), opts.idle, opts.workspaceKey) - Date.now())

  const wakeReason = (): ReattachReason => (signalled ? 'signal' : 'rescan')

  /**
   * Nothing drained, nothing failed, nothing signalled, for long enough.
   *
   * `failed > 0` counts as work on purpose: a row that threw is a row still
   * waiting, and a tier that detached with unpublished rows would defer them to
   * the rescan. The cost is that a permanently-poisoned row keeps its workspace
   * warm — the same row that already hot-spins the poll today.
   */
  const shouldDetach = (): boolean =>
    canDetach && (emptyRescanDetach || Date.now() - lastWorkAt >= opts.idle.detachAfterMs)

  const loop = async () => {
    while (running && !stopped) {
      let held = attachment
      if (!held) {
        const reason = s.passes === 0 && s.detaches === 0 ? 'boot' : wakeReason()
        signalled = false
        held = await attach(reason)
        if (!held) {
          if (!running || stopped) break
          const retryAt = descriptor ? quarantineRetryAt(descriptor.workspaceKey) : null
          await waitForWork(retryAt ? Math.max(250, retryAt - Date.now()) : 1_000)
          continue
        }
      }
      let waitMs = opts.config.pollIntervalMs
      try {
        // A held lease is only rewritten when it is due. Renewing at the top of
        // every pass wrote once a second to hold something with thirty seconds
        // left, which was this tier's dominant write volume and the one cost a
        // warm compute does not absorb.
        const renewDue = leaseRenewAt === 0 || Date.now() >= leaseRenewAt
        const next = lease
          ? renewDue
            ? await held.scoped(() =>
                renewRelayLease(held.db, lease as RelayLease, opts.config.leaseTtlMs)
              )
            : lease
          : await held.scoped(() => claimRelayLease(held.db, opts.config.leaseTtlMs))
        // Both branches that drop the lease also zero the clock, so `renewDue`
        // is always true on the pass that re-claims one.
        if (next && renewDue) leaseRenewAt = Date.now() + opts.config.leaseRenewIntervalMs

        if (!next) {
          if (lease) {
            s.leaseLosses += 1
            log.error(
              { workspaceKey: opts.workspaceKey, fence: s.fence },
              'lost outbox relay leadership while holding it — another replica took over. ' +
                'This means a drain pass outran the lease; nothing is lost (drains are ' +
                'idempotent) but the lease TTL is too short for this workspace.'
            )
          }
          lease = null
          leaseRenewAt = 0
          s.leader = false
          s.fence = null
          if (firstPassOfAttach) {
            emptyRescanDetach = attachReason === 'rescan' && lastWorkAt === lastWorkAtOnAttach
            firstPassOfAttach = false
          }
          // A follower must not drain. Re-ask on its own cadence rather than the
          // poll interval: it is asking about leadership, not about work. A
          // rescan that found no lease and published nothing must not linger
          // either — holding the sockets for detachAfterMs is the whole cost.
          if (!running || stopped) break
          if (shouldDetach()) {
            await detach()
            if (!running || stopped) break
            await waitForWork(detachedWaitMs())
            continue
          }
          await waitForWork(opts.config.followerRetryMs)
          continue
        }

        if (!lease || next.fence !== lease.fence) {
          log.info(
            { workspaceKey: opts.workspaceKey, fence: next.fence, owner: next.owner },
            'acquired outbox relay leadership'
          )
        }
        lease = next
        s.leader = true
        s.fence = next.fence
        s.schemaMissing = false

        const wokenAt = wakeAt
        wakeAt = null
        const res = await held.scoped(() => drainOnce({ batchSize: opts.config.batchSize }))
        record(res)
        if (res.drained > 0 || res.failed > 0) lastWorkAt = Date.now()
        if (firstPassOfAttach) {
          emptyRescanDetach =
            attachReason === 'rescan' &&
            res.drained === 0 &&
            res.failed === 0 &&
            lastWorkAt === lastWorkAtOnAttach
          firstPassOfAttach = false
        }
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
              { workspaceKey: opts.workspaceKey },
              'outbox_relay_leader is absent in this database (migration 0256 not applied); ' +
                'skipping this workspace rather than crash-looping'
            )
          }
          waitMs = Math.max(opts.config.followerRetryMs, opts.config.pollIntervalMs)
        } else {
          log.error({ err, workspaceKey: opts.workspaceKey }, 'outbox relay pass failed')
        }
      }
      if (!running || stopped) break
      if (shouldDetach()) {
        await detach()
        if (!running || stopped) break
        await waitForWork(detachedWaitMs())
        continue
      }
      await waitForWork(waitMs)
    }
    // Whatever ended the loop, the connections go with it.
    await detach().catch(() => {})
  }

  void runWithLogContext(
    {
      request_id: crypto.randomUUID(),
      route: 'events:relay-tier',
      workspace_key: opts.workspaceKey,
    },
    loop
  ).catch((err) => log.error({ err, workspaceKey: opts.workspaceKey }, 'outbox relay loop exited'))

  return {
    workspaceKey: opts.workspaceKey,
    ring,
    signal,
    observe(workspace) {
      const changed = descriptor !== null && descriptor.revision !== workspace.revision
      descriptor = workspace
      opts.onObserve?.(workspace)
      // A changed record may be a repaired one, and a quarantined loop is asleep
      // on the terminal backoff. Waking it is what turns an operator's fix into
      // a reconnection rather than a wait. Not counted as activity: the control
      // plane touching a row is not the workspace being used.
      if (changed && !attachment) {
        const resolve = wakeResolve
        wakeResolve = null
        resolve?.()
      }
    },
    isAttached: () => attachment !== null,
    async stop() {
      stopped = true
      live.stopped = true
      wakeResolve?.()
      // `detach` releases the lease first, hands over immediately rather than
      // making the next replica wait out the TTL, and closes the doorbell and
      // the pool. Shutdown wants exactly that, so it is the same path.
      await detach()
      stats.delete(opts.workspaceKey)
    },
  }
}

/** The message off whatever was thrown, for a refusal record. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
      { workspace: label },
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
      { err, workspace: label },
      'could not attach the outbox wake listener; this workspace drains on the poll fallback only'
    )
    return null
  }
}

function startSingleWorkspaceLoop(cfg: RelayTierConfig, idle: WorkspaceIdlePolicy): void {
  const holder: { ring: (() => void) | null } = { ring: null }
  const loop = startLoop({
    workspaceKey: SINGLE,
    config: cfg,
    idle,
    workspace: null,
    openAttachment: async () => ({
      db: ambientDb,
      scoped: (body) => body(),
      close: async () => {},
    }),
    openListener: async (ring, live, s) => {
      holder.ring = ring
      return openListener(config.databaseUrl, SINGLE, s, holder, live)
    },
  })
  loops.set(SINGLE, loop)
}

/**
 * Start this workspace's loop. The pool is opened by the loop, not here.
 *
 * It used to be opened eagerly, which made this function throw on a refusal and
 * made every caller responsible for catching per workspace. Now the loop owns the
 * whole attach/detach lifetime, so a refusal is one more thing the loop handles
 * — and it handles it by *not connecting again*, which is the point.
 */
function startWorkspaceLoop(
  workspace: WorkspaceDescriptor,
  cfg: RelayTierConfig,
  idle: WorkspaceIdlePolicy
): void {
  // Named before the connection is opened, so the likeliest misconfiguration is
  // reported against the field that carries it rather than as a doorbell that
  // quietly never rings. The NOTIFY round trip later is still the authority.
  warnIfPooled(workspace.database.directUrl, {
    workspaceKey: workspace.workspaceKey,
    use: 'the outbox relay',
  })

  const holder: { ring: (() => void) | null } = { ring: null }
  /**
   * The descriptor every re-attach reads, not the one this call closed over.
   *
   * A loop now outlives many attachments, and quarantine releases a workspace the
   * moment its `revision` changes — so a re-attach that still used the record
   * from boot would reconnect with the DSN and credential ref that were the
   * reason it was refused. `observe` keeps this current.
   */
  let current = workspace
  const loop = startLoop({
    workspaceKey: workspace.workspaceKey,
    config: cfg,
    idle,
    workspace,
    onObserve: (next) => {
      current = next
    },
    // One connection for the drain and the lease. The doorbell opens its own, so
    // an attached workspace costs this tier exactly two sockets, both session-mode,
    // and a detached one costs none. `openWorkspaceDirectPool` runs the same §3
    // fingerprint assertion the request path runs, so a mis-pointed record is
    // refused here for the same reason and with the same message.
    openAttachment: async () => {
      const pool = await openWorkspaceDirectPool(current)
      const scope = createWorkspaceScope({
        workspace: current,
        db: pool.db,
        sql: pool.sql,
        secrets: pool.secrets,
        origin: 'relay',
      })
      return {
        db: pool.db,
        scoped: (body) => runWithWorkspaceScope(scope, body),
        close: () => pool.close(),
      }
    },
    openListener: async (ring, live, s) => {
      holder.ring = ring
      return openListener(
        // Direct, never pooled. Through a transaction pooler the registration is
        // accepted and nothing is ever delivered — see jobs/wake.ts.
        current.database.directUrl,
        current.workspaceKey,
        s,
        holder,
        live,
        () => resolveWorkspacePassword(current)
      )
    },
  })
  loops.set(workspace.workspaceKey, loop)
}

/**
 * Reconcile the running loops against the active workspace list.
 *
 * Every failure is per workspace. A record the registry refuses, a database whose
 * fingerprint does not match, an unresolvable credential — each costs that
 * workspace its relay and nothing else. A pass that threw on the first bad record
 * would turn one wrong row in the control plane into a fleet-wide eventing
 * outage, which is a strictly worse failure than the one it is reacting to.
 *
 * Starting a loop no longer connects to anything, so nothing here can throw for
 * a workspace-specific reason any more: the refusal happens inside the loop, where
 * it can be classified and where a terminal one can stop the loop reconnecting.
 */
async function refreshWorkspaceLoops(
  cfg: RelayTierConfig,
  idle: WorkspaceIdlePolicy
): Promise<void> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) {
    log.error(
      { refused, active: workspaces.length },
      'outbox relay tier skipping workspaces with invalid registry records — the rest of the fleet continues'
    )
  }
  const wanted = new Set(workspaces.map((t) => t.workspaceKey))

  for (const [workspaceKey, loop] of loops) {
    if (wanted.has(workspaceKey)) continue
    log.info({ workspaceKey }, 'workspace left the active set — stopping its relay loop')
    await loop.stop()
    loops.delete(workspaceKey)
  }

  let started = 0
  for (const workspace of workspaces) {
    const existing = loops.get(workspace.workspaceKey)
    if (existing) {
      // The revision a quarantined refusal is compared against. Without this a
      // record repaired by the control plane would stay refused until restart.
      existing.observe(workspace)
      continue
    }
    startWorkspaceLoop(workspace, cfg, idle)
    started += 1
  }
  if (started > 0 || refused.length > 0) {
    log.info(
      { started, refused: refused.length, live: loops.size },
      'outbox relay tier workspace set reconciled'
    )
  }

  reportQuarantine()
}

/**
 * Re-arm the workspace refresh, deciding at FIRE time whether to actually read.
 *
 * The read goes to the control database, which is now expected to suspend when
 * the fleet goes quiet, so a fixed minute timer would be the client that keeps
 * it awake for ever — the same defect as the workspace doorbells, one level up.
 *
 * The first version chose the *interval* instead, stretching it to the rescan
 * interval whenever nothing was attached. That was wrong in a way only a
 * measurement showed: the choice is made when the timer is armed, and at boot it
 * is armed before any loop has finished attaching, so the fleet permanently read
 * its workspace list once every fifteen minutes. A record repaired by an operator
 * then sat unnoticed for that long, which is the one thing quarantine promised
 * it would not do.
 *
 * So the timer always fires on the minute and the *read* is what is conditional:
 * free while the fleet is doing something, skipped while it is not, and forced
 * on the same wall-clock rescan grid the workspaces use so the control database
 * shares the fleet's wake window rather than inventing one of its own.
 */
function scheduleWorkspaceRefresh(cfg: RelayTierConfig, idle: WorkspaceIdlePolicy): void {
  if (!running) return
  refreshTimer = setTimeout(() => {
    if (!running) return
    const anyAttached = [...loops.values()].some((l) => l.isAttached())
    const overdue = Date.now() >= nextRescanAt(lastFleetReadAt, idle, CONTROL_FLEET_RESCAN_KEY)
    if (!anyAttached && !overdue) {
      scheduleWorkspaceRefresh(cfg, idle)
      return
    }
    lastFleetReadAt = Date.now()
    void refreshWorkspaceLoops(cfg, idle)
      .catch((err) => log.error({ err }, 'outbox relay tier workspace refresh failed'))
      .finally(() => scheduleWorkspaceRefresh(cfg, idle))
  }, WORKSPACE_REFRESH_MS)
  refreshTimer.unref?.()
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
  const idle = workspaceIdlePolicy()

  // A scope opened by anything that is not a tier means the workspace's compute is
  // already awake and being used, so a detached loop should come straight back.
  unsubscribeActivity = onWorkspaceActivity((workspaceKey) => loops.get(workspaceKey)?.signal())

  if (!config.isPooledTenancy) {
    startSingleWorkspaceLoop(cfg, idle)
    log.info(
      { poll_interval_ms: cfg.pollIntervalMs, owner: relayOwnerId() },
      'outbox relay tier started (single workspace)'
    )
    return
  }

  await refreshWorkspaceLoops(cfg, idle)
  lastFleetReadAt = Date.now()
  scheduleWorkspaceRefresh(cfg, idle)
  log.info(
    {
      workspaces: loops.size,
      poll_interval_ms: cfg.pollIntervalMs,
      owner: relayOwnerId(),
      idle_detach_ms: idle.detachAfterMs,
      idle_rescan_ms: idle.rescanIntervalMs,
    },
    'outbox relay tier started (pooled)'
  )
}

export async function stopRelayTier(): Promise<void> {
  running = false
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  unsubscribeActivity?.()
  unsubscribeActivity = null
  const all = [...loops.values()]
  loops.clear()
  await Promise.allSettled(all.map((l) => l.stop()))
}

export interface RelayTierStatus {
  running: boolean
  owner: string
  workspaces: Array<{ workspaceKey: string } & RelayLoopStats>
}

export function getRelayTierStatus(): RelayTierStatus {
  return {
    running,
    owner: relayOwnerId(),
    workspaces: [...stats.entries()].map(([workspaceKey, s]) => ({ workspaceKey, ...s })),
  }
}

/**
 * Ring this workspace's relay loop if it exists.
 *
 * Matching `signalWorkspace` on the job tier so the wake route can knock on
 * both doors without knowing which map holds the key.
 */
export function signalWorkspace(workspaceKey: string): boolean {
  const loop = loops.get(workspaceKey)
  if (!loop) return false
  loop.signal()
  return true
}

/**
 * Re-read the active workspace set and start any missing relay loops.
 *
 * Used by the internal wake route when a key has no loop yet. The caller
 * rate-limits; this is the unthrottled reconcile.
 */
export function requestWorkspaceLoopRefresh(): void {
  if (!running) return
  if (!config.isPooledTenancy) return
  void refreshWorkspaceLoops(relayTierConfig(), workspaceIdlePolicy()).catch((err) =>
    log.error({ err }, 'outbox relay tier workspace refresh failed')
  )
}
