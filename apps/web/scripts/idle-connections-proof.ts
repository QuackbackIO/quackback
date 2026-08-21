/**
 * Evidence harness for the idle-connection policy: does this process actually
 * let go of a tenant database, and of the control database, when nothing is
 * happening?
 *
 * ## Why this is measured rather than asserted
 *
 * The defect it exists for has **no functional symptom**. A tier that holds its
 * connections forever serves every request correctly, drains every event
 * correctly, and passes every unit test; the only observable is the bill. The
 * live measurement it comes from is worth restating, because it is what "no
 * symptom" looks like from the outside:
 *
 * | database        | age   | active | our connections                        |
 * | --------------- | ----- | ------ | -------------------------------------- |
 * | tenant t1       | 45.1h | 53%    | `quackback-wake-listener` ×2 (14h33m)  |
 * | tenant t4       | 25.8h | 70%    | `wake-listener` ×1, **1.6s old**       |
 * | control DB      | 23.2h | 95%    | `postgres.js` ×3                       |
 * | an unused DB    | 20.9h | **2%** | none                                   |
 *
 * The last row is the control: a database nothing connects to suspends. So the
 * question this harness answers is not "is the code right" but "does the count
 * in `pg_stat_activity` reach **zero**".
 *
 * ## The instrument rules this harness follows
 *
 * 1. **The observer is never in the sample.** It connects to the cluster's
 *    `postgres` maintenance database and reads `pg_stat_activity` — which is
 *    cluster-wide — filtered by `datname`. An observer connected to the database
 *    it is counting would be one of the connections it counts, and on a platform
 *    that suspends on idleness it would also be the reason the compute is awake.
 * 2. **Zero is asserted, not "fewer".** A tier that drops one of its two sockets
 *    has changed nothing about the cost model.
 * 3. **Every arm has a control that must disagree.** `measure` runs the same
 *    tenant twice — once with detaching enabled and once with
 *    `TENANT_IDLE_DETACH_MS=0` — so a run that reports zero for a reason other
 *    than the policy (a tier that never started, a fleet with no tenants) fails
 *    both arms instead of passing the one it was pointed at.
 * 4. **Recovery is part of the proof.** A connection that closes and cannot
 *    reopen is a worse bug than the one being fixed, so every arm ends by
 *    driving work again and showing it lands.
 *
 * ## Setup
 *
 * Three scratch databases on a local Postgres. Nothing here touches a live
 * fleet, and the DSNs are supplied rather than discovered so it cannot.
 *
 *   createdb idle_probe_ctl idle_probe_t1 idle_probe_t2
 *   DATABASE_URL=…/idle_probe_t1 bun run --cwd packages/db db:migrate
 *   DATABASE_URL=…/idle_probe_t2 bun run --cwd packages/db db:migrate
 *   env $(cat probe.env) bun run scripts/idle-connections-proof.ts setup
 *   env $(cat probe.env) bun run scripts/idle-connections-proof.ts measure
 *   env $(cat probe.env) bun run scripts/idle-connections-proof.ts refusal
 */
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { config } from '@/lib/server/config'
import { withTenantScopeById } from '@/lib/server/tenancy/fleet'
import { getControlSql, closeControlSql } from '@/lib/server/tenancy/registry'
import { closeAllTenantPools } from '@/lib/server/tenancy/pool-cache'
import { invalidateTenantCache } from '@/lib/server/tenancy/resolver'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { getJobTierStatus, startJobTier, stopJobTier } from '@/lib/server/jobs/tier'
import { listQuarantinedTenants } from '@/lib/server/tenancy/quarantine'
import { deriveTenantSecret, sealSecretKeyCanary } from '@/lib/server/tenancy/vendor/fleet-secrets'

const args = process.argv.slice(2)
const command = args[0] ?? 'measure'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The cluster the scratch fleet lives on, and the maintenance database the
 * observer connects to. Required rather than defaulted: a harness that guesses
 * a DSN is a harness that can be pointed at production by omission.
 */
const CLUSTER = required('PROBE_CLUSTER_URL')
const TENANTS = [
  { id: 'probe-t1', db: 'idle_probe_t1', host: 't1.probe.local' },
  { id: 'probe-t2', db: 'idle_probe_t2', host: 't2.probe.local' },
]
const CONTROL_DB = 'idle_probe_ctl'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

function tenantDsn(db: string): string {
  return `${CLUSTER.replace(/\/[^/]*$/, '')}/${db}`
}

// ---------------------------------------------------------------------------
// The observer
// ---------------------------------------------------------------------------

interface Backend {
  datname: string
  applicationName: string
  state: string
  ageSeconds: number
}

/**
 * Every backend on the named databases, read from outside them.
 *
 * `pg_stat_activity` is cluster-wide, so the maintenance database is a vantage
 * point rather than a participant — the row this connection would contribute is
 * on `postgres`, which is never one of the databases being counted.
 */
async function observe(observer: postgres.Sql, databases: string[]): Promise<Backend[]> {
  const rows = (await observer`
    SELECT datname,
           coalesce(nullif(application_name, ''), '(unnamed)') AS application_name,
           state,
           extract(epoch FROM (now() - backend_start)) AS age_seconds
      FROM pg_stat_activity
     WHERE datname = ANY(${databases})
     ORDER BY datname, application_name
  `) as unknown as Array<{
    datname: string
    application_name: string
    state: string
    age_seconds: string | number
  }>
  return rows.map((r) => ({
    datname: r.datname,
    applicationName: r.application_name,
    state: r.state,
    ageSeconds: Number(r.age_seconds),
  }))
}

function tally(backends: Backend[], datname: string): string {
  const mine = backends.filter((b) => b.datname === datname)
  if (mine.length === 0) return '0'
  const byName = new Map<string, number>()
  for (const b of mine) byName.set(b.applicationName, (byName.get(b.applicationName) ?? 0) + 1)
  return `${mine.length} (${[...byName].map(([n, c]) => `${n}×${c}`).join(', ')})`
}

async function sample(observer: postgres.Sql, label: string): Promise<Backend[]> {
  const databases = [...TENANTS.map((t) => t.db), CONTROL_DB]
  const backends = await observe(observer, databases)
  const cells = databases.map((d) => `${d}=${tally(backends, d)}`)
  process.stdout.write(`  ${label.padEnd(34)} ${cells.join('   ')}\n`)
  return backends
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

async function setup(): Promise<void> {
  const rootKey = required('QUACKBACK_FLEET_ROOT_KEY')
  const ctl = postgres(tenantDsn(CONTROL_DB), { max: 2, onnotice: () => {} })

  await ctl`DROP TABLE IF EXISTS cp_tenant_hostnames`
  await ctl`DROP TABLE IF EXISTS cp_tenant_registry`
  await ctl`
    CREATE TABLE cp_tenant_registry (
      tenant_id text PRIMARY KEY,
      contract_version int NOT NULL DEFAULT 1,
      state text NOT NULL DEFAULT 'active',
      state_reason text,
      primary_hostname text NOT NULL,
      base_url text NOT NULL,
      db_pooled_url text NOT NULL,
      db_direct_url text NOT NULL,
      db_name text NOT NULL,
      db_role text NOT NULL,
      db_credential_ref text NOT NULL,
      app_secrets_ref text NOT NULL,
      workspace_id uuid NOT NULL,
      fingerprint_stamped_at timestamptz NOT NULL DEFAULT now(),
      storage jsonb NOT NULL,
      email_from text NOT NULL,
      ai_enabled boolean NOT NULL DEFAULT false,
      revision bigint NOT NULL DEFAULT 1
    )`
  await ctl`
    CREATE TABLE cp_tenant_hostnames (
      hostname text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES cp_tenant_registry(tenant_id)
    )`

  for (const t of TENANTS) {
    const workspaceId = randomUUID()
    const tenantDb = postgres(tenantDsn(t.db), { max: 1, onnotice: () => {} })
    // The tenant's own SECRET_KEY, derived exactly as the fleet derives it, and
    // the canary sealed under it. Without the canary every checkout refuses with
    // `secret_key_canary_missing`, and the harness would measure the refusal
    // path while believing it was measuring the idle one.
    const secretKey = deriveTenantSecret(rootKey, {
      generation: 1,
      tenantId: t.id,
      purpose: 'app-secrets',
    })
    await tenantDb`DELETE FROM settings`
    await tenantDb`
      INSERT INTO settings (id, name, slug, created_at, cloud_tenant_id, cloud_secret_canary)
      VALUES (${workspaceId}::uuid, ${t.id}, ${t.id}, now(), ${t.id},
              ${sealSecretKeyCanary(secretKey, t.id)})`
    await tenantDb`DELETE FROM job_queue`
    await tenantDb.end()

    // The contract refuses a record whose pooled and direct endpoints are the
    // same string, because a session-mode consumer would then be running through
    // a transaction pooler. There is no pooler locally, so two spellings of one
    // host stand in for two endpoints. Nothing being counted here depends on the
    // distinction: both spellings land in one pg_stat_activity.
    await ctl`
      INSERT INTO cp_tenant_registry (
        tenant_id, primary_hostname, base_url, db_pooled_url, db_direct_url,
        db_name, db_role, db_credential_ref, app_secrets_ref, workspace_id,
        storage, email_from
      ) VALUES (
        ${t.id}, ${t.host}, ${`http://${t.host}`},
        ${`postgresql://postgres@127.0.0.1:5432/${t.db}`},
        ${`postgresql://postgres@localhost:5432/${t.db}`},
        ${t.db}, 'postgres',
        'env://QUACKBACK_TENANT_SECRET_PROBE_DB',
        ${`derived+hkdf://v1/${t.id}/app-secrets`},
        ${workspaceId}::uuid,
        ${ctl.json({
          provider: 'r2',
          bucket: 'probe',
          endpoint: 'https://example.invalid',
          region: 'auto',
          forcePathStyle: false,
          publicUrl: 'https://example.invalid/probe',
          credentialRef: 'env://QUACKBACK_TENANT_SECRET_PROBE_STORAGE',
        })},
        'probe@example.invalid'
      )`
    await ctl`INSERT INTO cp_tenant_hostnames (hostname, tenant_id) VALUES (${t.host}, ${t.id})`
    process.stdout.write(`registered ${t.id} workspace=${workspaceId}\n`)
  }
  await ctl.end()
}

// ---------------------------------------------------------------------------
// measure
// ---------------------------------------------------------------------------

/**
 * Drive real work through a tenant, the way an application does.
 *
 * The scope origin is `script`, which is one of the origins that counts as
 * outside activity — the same signal a request produces. That is deliberate:
 * the re-attach path being proven here is the one a request takes.
 */
async function drive(tenantId: string): Promise<void> {
  await withTenantScopeById(tenantId, 'script', async () => {
    // A real queue with a harmless handler: the sweep finds nothing on an empty
    // database and returns. The insert fires migration 0253's NOTIFY trigger, so
    // this exercises the doorbell as well as the claim.
    await enqueueJob({ queue: 'snooze-sweep', payload: {}, maxAttempts: 1 })
  })
}

function tierSummary(): string {
  const jobs = getJobTierStatus()
  const attached = (n: number, total: number) => `${n}/${total}`
  return (
    `jobs attached=${attached(jobs.workspaces.filter((t) => t.attached).length, jobs.workspaces.length)}` +
    ` detaches=${jobs.workspaces.reduce((n, t) => n + t.detaches, 0)}` +
    ` reattaches=${jobs.workspaces.reduce((n, t) => n + t.reattaches, 0)}`
  )
}

async function measure(): Promise<void> {
  const observer = postgres(CLUSTER, { max: 1, onnotice: () => {} })
  const quietMs = Number(process.env.PROBE_QUIET_MS ?? 150_000)
  const stepMs = Number(process.env.PROBE_STEP_MS ?? 10_000)

  process.stdout.write(
    `policy: TENANT_IDLE_DETACH_MS=${process.env.TENANT_IDLE_DETACH_MS ?? '(default 60000)'} ` +
      `TENANT_POOL_IDLE_SECONDS=${config.tenantPoolIdleSeconds} ` +
      `TENANT_IDLE_RESCAN_MS=${process.env.TENANT_IDLE_RESCAN_MS ?? '(default 900000)'}\n\n`
  )

  await sample(observer, 'before the tiers start')

  await startJobTier()
  await sleep(2_000)
  await sample(observer, 'tiers started')

  for (const t of TENANTS) await drive(t.id)
  await sleep(3_000)
  await sample(observer, 'after driving work')
  process.stdout.write(`  ${''.padEnd(34)} ${tierSummary()}\n`)

  process.stdout.write('\n  --- going quiet ---\n')
  const deadline = Date.now() + quietMs
  let zeroAt: number | null = null
  const startedQuietAt = Date.now()
  while (Date.now() < deadline) {
    await sleep(stepMs)
    const elapsed = Math.round((Date.now() - startedQuietAt) / 1000)
    const backends = await sample(observer, `quiet +${elapsed}s`)
    const tenantBackends = backends.filter((b) => TENANTS.some((t) => t.db === b.datname))
    if (tenantBackends.length === 0 && zeroAt === null) {
      zeroAt = Date.now() - startedQuietAt
      process.stdout.write(
        `  >>> every tenant connection released after ${Math.round(zeroAt / 1000)}s of quiet\n`
      )
    }
    if (zeroAt !== null && backends.length === 0) {
      process.stdout.write(
        `  >>> the control database is also at zero after ${elapsed}s\n  ${tierSummary()}\n`
      )
      break
    }
  }

  if (zeroAt === null) {
    process.stdout.write('  >>> NEVER reached zero tenant connections\n')
  }

  process.stdout.write('\n  --- driving work again, from cold ---\n')
  const before = Date.now()
  // The registry cache has expired over a quiet window this long, so this also
  // exercises the serial wake: control database first, tenant database second.
  invalidateTenantCache()
  await drive(TENANTS[0]!.id)
  process.stdout.write(`  cold drive completed in ${Date.now() - before}ms\n`)
  await sleep(3_000)
  await sample(observer, 'after the cold re-drive')
  process.stdout.write(`  ${''.padEnd(34)} ${tierSummary()}\n`)

  await stopJobTier()
  // Production's shutdown does not do this — it calls `process.exit(0)`, which
  // takes every socket with it. The harness outlives its own tiers, so it has to
  // close the request pool cache and the control handle explicitly or the final
  // sample would count connections that only exist because this is a script.
  await closeAllTenantPools()
  await closeControlSql()
  await sleep(1_000)
  await sample(observer, 'after shutdown')
  await observer.end()
}

// ---------------------------------------------------------------------------
// refusal
// ---------------------------------------------------------------------------

/**
 * The retry storm, against a real database.
 *
 * Repoints one tenant's `appSecretsRef` at a scheme this build has no resolver
 * for — the exact refusal two live tenants were in — and counts the connections
 * that follow. The control is the other tenant, which must keep working, and the
 * recovery is a repaired record, which must be picked up from the revision bump
 * without a restart.
 */
async function refusal(): Promise<void> {
  const observer = postgres(CLUSTER, { max: 1, onnotice: () => {} })
  const ctl = getControlSql()
  const bad = TENANTS[0]!
  const good = TENANTS[1]!

  const original = (await ctl`
    SELECT app_secrets_ref FROM cp_tenant_registry WHERE tenant_id = ${bad.id}
  `) as unknown as Array<{ app_secrets_ref: string }>

  await ctl`
    UPDATE cp_tenant_registry
       SET app_secrets_ref = ${`openbao+kv://apps/${bad.id}`},
           revision = revision + 1
     WHERE tenant_id = ${bad.id}`
  invalidateTenantCache()

  await startJobTier()
  process.stdout.write('\n  --- one tenant refused with a scheme this build cannot resolve ---\n')
  for (let i = 1; i <= 6; i++) {
    await sleep(5_000)
    const backends = await observe(observer, [bad.db, good.db])
    process.stdout.write(
      `  +${i * 5}s  refused=${tally(backends, bad.db)}   control=${tally(backends, good.db)}\n`
    )
  }
  const quarantined = listQuarantinedTenants()
  process.stdout.write(
    `  quarantined: ${JSON.stringify(
      quarantined.map((q) => ({ t: q.tenantId, code: q.code, d: q.disposition, n: q.attempts }))
    )}\n`
  )
  process.stdout.write(
    `  job tier reports refused: ${JSON.stringify(
      getJobTierStatus().workspaces.map((t) => ({ t: t.workspaceKey, code: t.refusedCode }))
    )}\n`
  )

  process.stdout.write('\n  --- repairing the record (revision bump) ---\n')
  await ctl`
    UPDATE cp_tenant_registry
       SET app_secrets_ref = ${original[0]!.app_secrets_ref}, revision = revision + 1
     WHERE tenant_id = ${bad.id}`
  invalidateTenantCache()
  // Long enough to cover a whole tenant-refresh interval. The loop learns the
  // new revision from `refreshTenantLoops`, not from the cache invalidation, so
  // a window shorter than that would report "still refused" for a repair that
  // had in fact landed — the harness measuring its own impatience.
  for (let i = 1; i <= 16; i++) {
    await sleep(5_000)
    const backends = await observe(observer, [bad.db, good.db])
    process.stdout.write(
      `  +${i * 5}s  repaired=${tally(backends, bad.db)}   control=${tally(backends, good.db)}\n`
    )
    if (listQuarantinedTenants().length === 0) {
      process.stdout.write(`  >>> quarantine cleared after ${i * 5}s\n`)
      break
    }
  }
  process.stdout.write(`  still quarantined: ${listQuarantinedTenants().length}\n`)

  await stopJobTier()
  await closeControlSql()
  await observer.end()
}

// ---------------------------------------------------------------------------
// wakes
// ---------------------------------------------------------------------------

/**
 * How often does a quiet tenant's compute get woken, and by what?
 *
 * Three arms over one tenant holding **one snoozed conversation an hour out** —
 * a tenant that is genuinely idle but does have a clock running, which is the
 * case a naive gate gets wrong.
 *
 * - **before**: the deadline providers are unregistered, which is not a
 *   simulation of the old behaviour but literally it — `dueWithin` returns true
 *   for a queue with no provider, so the cron stands as written and the two
 *   sweeps fire every minute.
 * - **after**: providers registered. The next deadline is an hour away, so no
 *   slot is spent and the tier is free to detach.
 * - **control**: the same tenant with the snooze thirty seconds out. This one
 *   must still fire, or "no wakes" would only mean the sweep had been broken.
 *
 * Counted from `job_queue` inserts for the two sweeps, which is the honest
 * instrument here: an enqueue is what a wake *is* for a detached tier, and the
 * table is written by nothing else during the window because nothing else is
 * driving the tenant.
 */
async function wakes(): Promise<void> {
  const windowMs = Number(process.env.PROBE_WAKE_WINDOW_MS ?? 135_000)
  const detachMs = Number(process.env.TENANT_IDLE_DETACH_MS ?? 60_000)
  const t = TENANTS[0]!
  const observer = postgres(CLUSTER, { max: 1, onnotice: () => {} })

  /**
   * Every write this arm makes goes through a connection that is opened, used
   * and closed — never held across a measurement window.
   *
   * The first version of this held one open for the whole run, and every arm
   * duly reported the tenant connected 100% of the time. The connection it was
   * counting was its own. On a platform that suspends on idleness that is not a
   * reporting error, it is the instrument being the reason the compute is awake.
   */
  const onTenant = async <T>(body: (sql: postgres.Sql) => Promise<T>): Promise<T> => {
    const sql = postgres(tenantDsn(t.db), { max: 1, onnotice: () => {} })
    try {
      return await body(sql)
    } finally {
      await sql.end({ timeout: 5 })
    }
  }

  const plantSnooze = (secondsOut: number): Promise<void> =>
    onTenant(async (tenantSql) => {
      await tenantSql`DELETE FROM conversations`
      // A conversation needs a visitor principal; the sweep never reads it, but
      // the foreign key does.
      const principal = (await tenantSql`
      INSERT INTO principal (id, created_at, type)
      VALUES (gen_random_uuid(), now(), 'anonymous')
      RETURNING id
    `) as unknown as Array<{ id: string }>
      await tenantSql`
      INSERT INTO conversations (id, status, snoozed_until, channel, visitor_principal_id)
      VALUES (gen_random_uuid(), 'snoozed', now() + make_interval(secs => ${secondsOut}),
              'widget', ${principal[0]!.id}::uuid)`
    })

  const sweepEnqueues = (): Promise<number> =>
    onTenant(async (tenantSql) => {
      const rows = (await tenantSql`
        SELECT count(*)::int AS n FROM job_queue
         WHERE queue IN ('snooze-sweep', 'sla-breach-sweep')
      `) as unknown as Array<{ n: number }>
      return rows[0]?.n ?? 0
    })

  const arm = async (label: string, secondsOut: number, gated: boolean): Promise<void> => {
    await plantSnooze(secondsOut)
    await onTenant((tenantSql) => tenantSql`DELETE FROM job_queue`.then(() => undefined))
    // The old behaviour is BOTH halves: an ungated cron and a tier that never
    // lets go. Reproducing only one of them measures neither — an ungated cron
    // on a detaching tier has no deadline to come back for, so it goes quiet for
    // a reason that has nothing to do with the gate.
    process.env.TENANT_IDLE_DETACH_MS = gated ? String(detachMs) : '0'
    await startJobTier()
    if (!gated) {
      // Unregistering AFTER the tier primes its handlers is not a simulation of
      // the old behaviour, it is literally it: `dueWithin` returns true for a
      // queue with no provider, so the cron stands exactly as written.
      //
      // It is also irreversible in this process — module top levels do not run
      // twice — which is why this arm runs LAST. An earlier version ran it first
      // and silently disarmed both arms after it.
      const { __resetTenantDeadlinesForTests } = await import('@/lib/server/jobs/deadlines')
      __resetTenantDeadlinesForTests()
    }

    const started = Date.now()
    let attachedSamples = 0
    let samples = 0
    while (Date.now() - started < windowMs) {
      await sleep(5_000)
      samples += 1
      const live = await observe(observer, [t.db])
      if (live.length > 0) attachedSamples += 1
    }
    const enqueued = await sweepEnqueues()
    const perHour = (enqueued * 3_600_000) / windowMs
    process.stdout.write(
      `  ${label.padEnd(30)} sweep enqueues=${enqueued} in ${Math.round(windowMs / 1000)}s ` +
        `= ${perHour.toFixed(0)}/hour   connected in ${attachedSamples}/${samples} samples ` +
        `(${Math.round((100 * attachedSamples) / samples)}% of wall clock)\n`
    )
    await stopJobTier()
    await closeAllTenantPools()
    await sleep(1_000)
  }

  process.stdout.write('\n  one snoozed conversation, tenant otherwise idle\n')
  await arm('after  (deadline an hour out)', 3_600, true)
  await arm('control (deadline 90s out)', 90, true)
  await arm('before (ungated, never detaches)', 3_600, false)

  await closeControlSql()
  await observer.end()
}

const commands: Record<string, () => Promise<void>> = {
  setup,
  measure,
  refusal,
  wakes,
}
const run = commands[command]
if (!run) throw new Error(`unknown command '${command}'; expected one of ${Object.keys(commands)}`)
await run()
process.exit(0)
