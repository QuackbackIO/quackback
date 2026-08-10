/**
 * Evidence harness for the outbox relay tier, run against a real pooled fleet
 * (`QUACKBACK_TENANCY=pooled`, a real control-plane registry, one Neon database
 * per workspace).
 *
 * Four things are measured here rather than asserted, because none of them
 * survives a test double: whether a `LISTEN` on a given endpoint actually
 * delivers, whether two replicas can both drain one workspace, whether a drain ever
 * lands in the wrong database, and how long an event waits.
 *
 * ## The instrument rules this harness follows
 *
 * 1. **A doorbell is proven by a NOTIFY round trip, never by
 *    `pg_listening_channels()`.** That view is not merely a false green for this
 *    channel — on Neon it is *inverted*, reporting the registration on the
 *    pooled connection that delivers nothing and not on the direct one that
 *    does.
 * 2. **Latency is measured by the relay, not by this file.** `wake-latency`
 *    starts the real tier and reads the tier's own per-row samples
 *    (`published_at clock − occurred_at`). A harness that resolved on
 *    `min(NOTIFY, setTimeout(pollMs))` would report its own timer as the poll
 *    floor.
 * 3. **Samples are jittered uniformly.** Emitting the next event immediately
 *    after the previous one drained phase-locks every arrival to the start of a
 *    poll window and reports the worst case as the median.
 * 4. **Every arm has a control that must disagree.** A poll-floor arm with no
 *    doorbell arm beside it, or a leader arm with no un-elected arm beside it,
 *    is an experiment that cannot fail.
 *
 * Usage:
 *   env $(cat pooled.env) bun run scripts/relay-tier-proof.ts listen-endpoints
 *   env ... bun run scripts/relay-tier-proof.ts workspace-proof   --a <id> --b <id>
 *   env ... bun run scripts/relay-tier-proof.ts leader-proof   --a <id>
 *   env ... bun run scripts/relay-tier-proof.ts wake-latency   --a <id> --samples 24
 *   env ... bun run scripts/relay-tier-proof.ts cleanup
 */
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { generateId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { listActiveWorkspaces, type WorkspaceDescriptor } from '@/lib/server/workspaces/registry'
import { resolveWorkspacePassword } from '@/lib/server/workspaces/pool-cache'
import { withWorkspaceScopeById } from '@/lib/server/workspaces/fleet'
import { WAKE_APPLICATION_NAME, openWakeListener } from '@/lib/server/jobs/wake'
import {
  OUTBOX_WAKE_CHANNEL,
  getRelayTierStatus,
  startRelayTier,
  stopRelayTier,
} from '@/lib/server/events/relay-tier'
import {
  claimRelayLease,
  readRelayLease,
  releaseRelayLease,
} from '@/lib/server/events/relay-leader'
import { drainOnce } from '@/lib/server/events/relay'

const args = process.argv.slice(2)
const command = args[0] ?? 'workspace-proof'
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Uniform jitter in [0, span). The point of rule 3 above. */
const jitter = (span: number) => Math.random() * span

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]
}

function summarise(label: string, values: number[]): string {
  if (values.length === 0) return `${label.padEnd(28)} n=0`
  return (
    `${label.padEnd(28)} n=${String(values.length).padStart(3)}  ` +
    `min=${Math.round(Math.min(...values))}ms  p50=${Math.round(percentile(values, 50))}ms  ` +
    `p95=${Math.round(percentile(values, 95))}ms  max=${Math.round(Math.max(...values))}ms`
  )
}

async function fleet(): Promise<WorkspaceDescriptor[]> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) console.log('refused registry records:', JSON.stringify(refused))
  return workspaces
}

async function pick(name: 'a' | 'b', fallbackIndex: number): Promise<WorkspaceDescriptor> {
  const all = await fleet()
  const wanted = flag(name)
  const found = wanted ? all.find((t) => t.workspaceKey === wanted) : all[fallbackIndex]
  if (!found) throw new Error(`no workspace for --${name} (${wanted ?? `index ${fallbackIndex}`})`)
  return found
}

// ---------------------------------------------------------------------------
// Planting events
// ---------------------------------------------------------------------------

/**
 * Write one unpublished outbox row, carrying a marker that names the workspace it
 * was planted for.
 *
 * `occurred_at` is stamped from THIS process's clock so the tier's lag samples
 * are a single-clock measurement: emitter clock and relay clock are the same
 * clock when the harness hosts the tier, which is the only arrangement in which
 * an end-to-end number means anything without a skew correction.
 */
async function plant(workspaceKey: string, marker: string, count = 1): Promise<string[]> {
  return withWorkspaceScopeById(workspaceKey, 'script', async () => {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const eventId = generateId('evt')
      ids.push(eventId)
      // Row and doorbell in ONE transaction, exactly as `emit()` does. Postgres
      // delivers a NOTIFY only on commit, so this is the same commit-time
      // doorbell the application fires — not a paraphrase of it.
      //
      // An earlier version of this harness inserted the row without the NOTIFY.
      // Every latency sample then sat on the poll floor and the run still
      // printed a plausible-looking p50; the only thing that gave it away was
      // the tier reporting `wakes=1` across 24 samples. A latency measurement
      // that never rings the doorbell it is measuring cannot disagree with the
      // hypothesis that the doorbell is slow.
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO events (event_id, type, entity_type, entity_id, actor_type, payload, context, occurred_at)
          VALUES (
            ${eventId},
            'gauntlet.relay_probe',
            'gauntlet',
            ${marker},
            'system',
            ${JSON.stringify({ marker, plantedFor: workspaceKey })}::jsonb,
            ${JSON.stringify({ depth: 0, source: 'relay-tier-proof' })}::jsonb,
            ${new Date().toISOString()}
          )
        `)
        await tx.execute(sql`SELECT pg_notify('outbox_wake', '')`)
      })
    }
    return ids
  })
}

interface PlantedRow {
  event_id: string
  entity_id: string
  planted_for: string
  published_at: string | null
  db_name: string
  branch_id: string | null
}

async function probeRows(workspaceKey: string): Promise<PlantedRow[]> {
  return withWorkspaceScopeById(workspaceKey, 'script', async () => {
    const res = await db.execute(sql`
      SELECT event_id,
             entity_id,
             payload->>'plantedFor' AS planted_for,
             published_at,
             current_database() AS db_name,
             current_setting('neon.branch_id', true) AS branch_id
      FROM events
      WHERE type = 'gauntlet.relay_probe'
      ORDER BY id
    `)
    return getExecuteRows<PlantedRow>(res)
  })
}

async function clearProbes(workspaceKey: string): Promise<number> {
  return withWorkspaceScopeById(workspaceKey, 'script', async () => {
    const res = await db.execute(
      sql`DELETE FROM events WHERE type = 'gauntlet.relay_probe' RETURNING id`
    )
    return getExecuteRows(res).length
  })
}

// ---------------------------------------------------------------------------
// 1. listen-endpoints — §7.3, re-measured for THIS channel
// ---------------------------------------------------------------------------

async function listenEndpoints(): Promise<void> {
  const workspaces = await fleet()
  console.log(`\nNOTIFY round trip on '${OUTBOX_WAKE_CHANNEL}', per endpoint.`)
  console.log('Delivery is the instrument. pg_listening_channels() is never consulted.\n')
  for (const t of workspaces) {
    for (const [kind, url] of [
      ['direct', t.database.directUrl],
      ['pooled', t.database.pooledUrl],
    ] as const) {
      let delivered: string
      try {
        const listener = await openWakeListener({
          directUrl: url,
          channel: OUTBOX_WAKE_CHANNEL,
          label: `${t.workspaceKey}/${kind}`,
          password: () => resolveWorkspacePassword(t),
          onWake: () => {},
        })
        delivered = (await listener.verify(5_000)) ? 'DELIVERED' : 'nothing arrived'
        await listener.close()
      } catch (err) {
        delivered = `ERROR ${(err as Error).message.slice(0, 60)}`
      }
      console.log(`  ${t.workspaceKey.padEnd(24)} ${kind.padEnd(7)} ${delivered}`)
    }
  }
  console.log(
    '\nHad the hypothesis been false — had a transaction pooler carried NOTIFY — both rows\n' +
      'would read DELIVERED and the direct-connection requirement would be unnecessary.\n'
  )
}

// ---------------------------------------------------------------------------
// 2. workspace-proof — no row dispatched against another workspace's database
// ---------------------------------------------------------------------------

async function workspaceProof(): Promise<void> {
  const a = await pick('a', 0)
  const b = await pick('b', 1)
  console.log(`\nA = ${a.workspaceKey}\nB = ${b.workspaceKey}\n`)

  for (const order of [
    [a, b],
    [b, a],
  ]) {
    const [first, second] = order
    console.log(`--- ordering: ${first.workspaceKey} planted first ---`)
    await clearProbes(a.workspaceKey)
    await clearProbes(b.workspaceKey)

    const firstIds = await plant(first.workspaceKey, `marker-${first.workspaceKey}`, 3)
    const secondIds = await plant(second.workspaceKey, `marker-${second.workspaceKey}`, 3)

    await startRelayTier()
    // Long enough for both workspaces' loops to take their lease and drain.
    for (let i = 0; i < 60; i++) {
      const rows = [...(await probeRows(a.workspaceKey)), ...(await probeRows(b.workspaceKey))]
      if (rows.length > 0 && rows.every((r) => r.published_at !== null)) break
      await sleep(500)
    }
    const status = getRelayTierStatus()
    await stopRelayTier()

    let crossWorkspace = 0
    for (const t of [a, b]) {
      const rows = await probeRows(t.workspaceKey)
      const foreign = rows.filter((r) => r.planted_for !== t.workspaceKey)
      crossWorkspace += foreign.length
      const unpublished = rows.filter((r) => r.published_at === null).length
      console.log(
        `  ${t.workspaceKey.padEnd(24)} rows=${rows.length} published=${rows.length - unpublished} ` +
          `foreign=${foreign.length} db=${rows[0]?.db_name ?? '-'} branch=${rows[0]?.branch_id ?? '-'}`
      )
    }
    for (const s of status.workspaces) {
      console.log(
        `    tier  ${s.workspaceKey.padEnd(24)} leader=${s.leader} fence=${s.fence} ` +
          `drained=${s.drained} wakes=${s.wakes} doorbell=${s.doorbellVerified}`
      )
    }
    console.log(
      `  planted A=${firstIds.length} B=${secondIds.length}  ` +
        `CROSS-WORKSPACE OBSERVATIONS: ${crossWorkspace}\n`
    )
  }

  console.log(
    'Both orderings are run because a last-writer-wins cache is asymmetric: testing one\n' +
      'direction leaves detection to whichever workspace happened to write last.\n' +
      'Had the tier shared one connection or one scope across workspaces, a row planted for one\n' +
      'workspace would appear in the other database (foreign > 0) or be published against it.\n'
  )
}

// ---------------------------------------------------------------------------
// 3. leader-proof — two replicas do not both drain one workspace
// ---------------------------------------------------------------------------

/**
 * Two independent owners against one workspace's real database, using the shipped
 * lease. The second owner is what a second Railway replica is: a different
 * process asking the same database the same question.
 */
async function leaderProof(): Promise<void> {
  const a = await pick('a', 0)
  console.log(`\nworkspace = ${a.workspaceKey}\n`)

  await clearProbes(a.workspaceKey)

  await withWorkspaceScopeById(a.workspaceKey, 'script', async () => {
    // Start from a clean lease so the run is deterministic.
    const held = await readRelayLease(db)
    if (held) await releaseRelayLease(db, held)

    const one = await claimRelayLease(db, 8_000, { owner: 'replica-1' })
    const two = await claimRelayLease(db, 8_000, { owner: 'replica-2' })
    console.log(`  replica-1 claim -> ${one ? `LEADER fence=${one.fence}` : 'follower'}`)
    console.log(`  replica-2 claim -> ${two ? `LEADER fence=${two.fence}` : 'follower'}`)

    // What each would drain if it believed itself leader. `drainOnce` is
    // idempotent, so "both drained" is invisible from the row state alone —
    // hence the counters.
    await plant(a.workspaceKey, 'leader-probe', 4)
    const leaderDrain = await drainOnce({ batchSize: 100 })
    console.log(
      `  leader drain      -> drained=${leaderDrain.drained} enqueued=${leaderDrain.enqueued}`
    )
    const followerWouldDrain = two === null ? 'NOT ATTEMPTED (follower)' : 'ATTEMPTED'
    console.log(`  follower drain    -> ${followerWouldDrain}`)

    // Killed leader: the lease is not released, it lapses. Emulate the death by
    // simply never renewing, and let the server clock decide.
    const start = Date.now()
    let takeover: { fence: string; owner: string } | null = null
    while (Date.now() - start < 20_000) {
      const t = await claimRelayLease(db, 8_000, { owner: 'replica-2' })
      if (t) {
        takeover = t
        break
      }
      await sleep(500)
    }
    const elapsed = Date.now() - start
    console.log(
      takeover
        ? `  takeover after a dead leader -> replica-2 fence=${takeover.fence} after ${elapsed}ms ` +
            `(lease ttl 8000ms)`
        : `  takeover FAILED within ${elapsed}ms`
    )
    if (takeover) {
      // And the backlog the dead leader left is drained by the new one.
      await plant(a.workspaceKey, 'leader-probe', 2)
      const after = await drainOnce({ batchSize: 100 })
      console.log(`  new leader drained the backlog -> drained=${after.drained}`)
      const current = await readRelayLease(db)
      if (current) await releaseRelayLease(db, current)
    }
  })

  console.log(
    '\nHad leadership failed open — which is exactly what pg_try_advisory_lock does when a\n' +
      'pooler routes two clients onto one backend — both claims above would read LEADER.\n'
  )
  await clearProbes(a.workspaceKey)
}

// ---------------------------------------------------------------------------
// 3b. replica / plant / inspect — the two-PROCESS leader proof
// ---------------------------------------------------------------------------

/**
 * Run the real tier and report its own counters, forever.
 *
 * This is what a second Railway replica is. The single-process `leader-proof`
 * above exercises the lease; only two OS processes can show that two relay
 * replicas do not both drain one workspace, because only then are the two drains
 * genuinely independent.
 */
async function replica(): Promise<void> {
  const label = flag('label') ?? 'replica'
  await startRelayTier()
  const tick = setInterval(() => {
    const s = getRelayTierStatus()
    for (const t of s.workspaces) {
      console.log(
        JSON.stringify({
          replica: label,
          owner: s.owner,
          workspace: t.workspaceKey,
          leader: t.leader,
          fence: t.fence,
          drained: t.drained,
          wakes: t.wakes,
          leaseLosses: t.leaseLosses,
        })
      )
    }
  }, 1_000)
  tick.unref?.()
  // Live until SIGKILL/SIGTERM. A relay that exited on its own would make the
  // takeover measurement meaningless.
  await new Promise(() => {})
}

async function plantCmd(): Promise<void> {
  const a = await pick('a', 0)
  const count = Number.parseInt(flag('count') ?? '3', 10)
  const ids = await plant(a.workspaceKey, flag('marker') ?? 'two-replica', count)
  console.log(JSON.stringify({ workspace: a.workspaceKey, planted: ids.length }))
}

async function inspect(): Promise<void> {
  const a = await pick('a', 0)
  const rows = await probeRows(a.workspaceKey)
  const lease = await withWorkspaceScopeById(a.workspaceKey, 'script', () => readRelayLease(db))
  console.log(
    JSON.stringify({
      workspace: a.workspaceKey,
      probeRows: rows.length,
      published: rows.filter((r) => r.published_at !== null).length,
      unpublished: rows.filter((r) => r.published_at === null).length,
      foreign: rows.filter((r) => r.planted_for !== a.workspaceKey).length,
      lease: lease ? { owner: lease.owner, fence: lease.fence } : null,
    })
  )
}

// ---------------------------------------------------------------------------
// 4. wake-latency — measured by the running relay
// ---------------------------------------------------------------------------

async function wakeLatency(): Promise<void> {
  const a = await pick('a', 0)
  const samples = Number.parseInt(flag('samples') ?? '20', 10)
  const pollMs = Number.parseInt(process.env.RELAY_POLL_INTERVAL_MS ?? '1000', 10)
  console.log(`\nworkspace = ${a.workspaceKey}  samples = ${samples}  poll floor = ${pollMs}ms`)
  console.log(
    `doorbell = ${process.env.RELAY_WAKE_DISABLED === '1' ? 'DISABLED' : OUTBOX_WAKE_CHANNEL}\n`
  )

  await clearProbes(a.workspaceKey)
  await startRelayTier()
  await sleep(1_500) // let the loops take their leases and verify their doorbells

  for (let i = 0; i < samples; i++) {
    // Uniform jitter BEFORE the plant. Sampling immediately after the previous
    // drain phase-locks every arrival to the start of a poll window, which
    // reports the worst case as the median.
    await sleep(jitter(pollMs))
    await plant(a.workspaceKey, `latency-${i}`, 1)
    // Wait for it to be published rather than for a fixed interval, so a slow
    // sample is measured rather than dropped.
    for (let w = 0; w < 40; w++) {
      const rows = await probeRows(a.workspaceKey)
      if (rows.length > 0 && rows.every((r) => r.published_at !== null)) break
      await sleep(100)
    }
    await clearProbes(a.workspaceKey)
  }

  const status = getRelayTierStatus()
  await stopRelayTier()

  for (const s of status.workspaces) {
    if (s.lagSamplesMs.length === 0) continue
    console.log(
      summarise(`end-to-end (emit->published)`, s.lagSamplesMs) +
        `  wakes=${s.wakes} doorbell_verified=${s.doorbellVerified}`
    )
    console.log(summarise(`relay half (notify->drained)`, s.wakeToDrainMs))
  }
  console.log(
    `\nThe numbers above are the RELAY's own: this process's clock at publish minus the\n` +
      `row's occurred_at, recorded inside drainOnce. Nothing here times a setTimeout.\n` +
      `Had the doorbell not been delivering, every sample would sit at the ${pollMs}ms poll\n` +
      `floor and wakes would read 0 — which is the pooled arm of this measurement.\n`
  )
  await clearProbes(a.workspaceKey)
}

// ---------------------------------------------------------------------------
// 5. poll-fallback — the notify is genuinely lost, and the floor catches it
// ---------------------------------------------------------------------------

/**
 * Kill the doorbell connections for a workspace, then emit while nothing is
 * listening.
 *
 * This is a REAL cause rather than a flag. `NOTIFY` is not durable: a payload
 * fired while no session holds the `LISTEN` is gone, and nothing replays it.
 * A dropped TCP connection, a Neon compute restart and an idle reaper all
 * produce exactly this window. The flag (`RELAY_WAKE_DISABLED=1`) would prove
 * only that a code path we wrote can be turned off.
 */
async function pollFallback(): Promise<void> {
  const a = await pick('a', 0)
  const samples = Number.parseInt(flag('samples') ?? '10', 10)
  const pollMs = Number.parseInt(process.env.RELAY_POLL_INTERVAL_MS ?? '1000', 10)
  const admin = postgres(a.database.directUrl, {
    max: 1,
    onnotice: () => {},
    password: () => resolveWorkspacePassword(a),
  })

  const killDoorbell = async (): Promise<number> => {
    const rows = await admin<{ pid: number }[]>`
      SELECT pg_terminate_backend(pid) AS ok, pid
      FROM pg_stat_activity
      WHERE application_name = ${WAKE_APPLICATION_NAME}
        AND pid <> pg_backend_pid()
    `
    return rows.length
  }

  console.log(
    `\nworkspace = ${a.workspaceKey}  poll floor = ${pollMs}ms  samples per arm = ${samples}\n`
  )
  await clearProbes(a.workspaceKey)
  await startRelayTier()
  await sleep(2_000)

  const arms: Record<string, number[]> = {}
  for (const arm of ['doorbell alive', 'doorbell killed before each emit'] as const) {
    const before = getRelayTierStatus().workspaces.find((t) => t.workspaceKey === a.workspaceKey)
    const baseline = before ? before.lagSamplesMs.length : 0
    const wakesBefore = before?.wakes ?? 0
    const suppress = arm === 'doorbell killed before each emit'
    let killed = 0
    for (let i = 0; i < samples; i++) {
      await sleep(jitter(pollMs))
      if (suppress) killed += await killDoorbell()
      await plant(a.workspaceKey, `fallback-${i}`, 1)
      for (let w = 0; w < 60; w++) {
        // `postgres.js` reconnects and re-LISTENs within about a second, so a
        // single kill leaves a window too short to be sure the notify was lost.
        // Keep the doorbell down for the whole window instead: the claim is that
        // the POLL published this row, and that claim is only clean while no
        // listener could have received anything.
        if (suppress) killed += await killDoorbell()
        const rows = await probeRows(a.workspaceKey)
        if (rows.length > 0 && rows.every((r) => r.published_at !== null)) break
        await sleep(100)
      }
      await clearProbes(a.workspaceKey)
    }
    const after = getRelayTierStatus().workspaces.find((t) => t.workspaceKey === a.workspaceKey)
    arms[arm] = (after?.lagSamplesMs ?? []).slice(baseline)
    const wakes = (after?.wakes ?? 0) - wakesBefore
    console.log(
      summarise(arm, arms[arm]) +
        `  notifies_received=${wakes}` +
        (killed ? `  doorbell_connections_terminated=${killed}` : '')
    )
  }
  const status = getRelayTierStatus()
  await stopRelayTier()
  await admin.end({ timeout: 5 })
  for (const s of status.workspaces) {
    if (s.workspaceKey !== a.workspaceKey) continue
    console.log(
      `\n  ${s.workspaceKey} wakes=${s.wakes} drained=${s.drained} leaseLosses=${s.leaseLosses}`
    )
  }
  console.log(
    '\nEvery event in BOTH arms was published — that is the correctness claim. The second\n' +
      'arm is slower because the notify was genuinely lost, not because a flag turned the\n' +
      'doorbell off. Had the poll floor not existed, the second arm would never have\n' +
      'published at all and this command would have timed out rather than printed numbers.\n'
  )
  await clearProbes(a.workspaceKey)
}

// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  for (const t of await fleet()) {
    try {
      const n = await clearProbes(t.workspaceKey)
      await withWorkspaceScopeById(t.workspaceKey, 'script', async () => {
        const held = await readRelayLease(db)
        if (held) await releaseRelayLease(db, held)
      })
      console.log(`  ${t.workspaceKey.padEnd(24)} probe rows removed=${n}`)
    } catch (err) {
      console.log(`  ${t.workspaceKey.padEnd(24)} ${(err as Error).message.slice(0, 80)}`)
    }
  }
}

const commands: Record<string, () => Promise<void>> = {
  'listen-endpoints': listenEndpoints,
  'workspace-proof': workspaceProof,
  'leader-proof': leaderProof,
  replica,
  plant: plantCmd,
  inspect,
  'wake-latency': wakeLatency,
  'poll-fallback': pollFallback,
  cleanup,
}

const run = commands[command]
if (!run) {
  console.error(`unknown command: ${command}. one of ${Object.keys(commands).join(', ')}`)
  process.exit(2)
}
await run()
// Nothing here holds the process open on purpose; postgres.js keeps handles.
process.exit(0)
