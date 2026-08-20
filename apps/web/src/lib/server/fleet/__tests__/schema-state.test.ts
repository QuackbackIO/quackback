/**
 * `cp_workspace_schema_state` claiming, against a real Postgres, through the
 * shipped migration SQL.
 *
 * None of these properties survives being mocked: `FOR UPDATE SKIP LOCKED`, the
 * `attempts < max_attempts` predicate, the fencing token and the lease-shape
 * `CHECK` are database behaviour, and a test double would only assert that the
 * strings written are the strings written.
 *
 * The schema comes from `quackback-cp`'s `drizzle/0049_tenant_schema_state.sql`
 * verbatim rather than from a hand-written CREATE TABLE, because the constraints
 * *are* half of what is being tested — a fixture that re-typed them could pass
 * against a table the control plane will never have. The only thing stubbed is
 * the `cp_tenant_registry` the foreign key points at, which lives in the other
 * repository and is not what these tests are about.
 *
 * Each run gets its own scratch database, so nothing here depends on the shared
 * `quackback_test` and no assertion counts rows it does not own.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { createDbFromSql } from '@quackback/db/client'
import {
  __setControlDbForTests,
  blockWorkspace,
  claimWorkspaces,
  completeWorkspace,
  ensureSchemaStateRow,
  failWorkspace,
  heartbeatWorkspace,
  listSchemaState,
  reapExpiredWorkspaceLeases,
  setTargetVersion,
} from '../schema-state'

const MIGRATION_SQL_PATH =
  process.env.CP_SCHEMA_STATE_SQL ??
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', '0049_tenant_schema_state.sql')

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const SCRATCH = `qb_p10_state_${randomUUID().replace(/-/g, '').slice(0, 12)}`

let admin: postgres.Sql
let sql: postgres.Sql

const TARGET = 1785700000012
const OLD = 1785700000006

async function seed(workspaceKey: string, opts?: { maxAttempts?: number; cohort?: string }) {
  await ensureSchemaStateRow({
    workspaceKey,
    targetVersion: TARGET,
    cohort: opts?.cohort,
    maxAttempts: opts?.maxAttempts,
  })
}

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${SCRATCH}`)
  sql = postgres(ADMIN_URL.replace(/\/[^/]+$/, `/${SCRATCH}`), { max: 4, onnotice: () => {} })

  // The FK target. Stubbed to its primary key only: the real table is the
  // control plane's and is not under test here.
  //
  // Named `cp_tenant_registry`, not `cp_workspace_registry`, and that is not an
  // oversight. This suite applies migration 0049 verbatim, and 0049 was written
  // before the rename: its REFERENCES clause names the old table. A historical
  // migration is a fixed artefact — renaming the stub to match today's
  // vocabulary makes the FK point at a table that does not exist in this
  // scratch database. The control plane's own 0054 renames the real table and
  // leaves a view behind; this stub stands in for neither.
  await sql.unsafe(`CREATE TABLE cp_tenant_registry (tenant_id text PRIMARY KEY)`)
  const migration = readFileSync(MIGRATION_SQL_PATH, 'utf8')
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim() !== '') await sql.unsafe(statement)
  }
  // 0049 creates the pre-rename names because that is what it said when it was
  // written. The control plane's 0054 is what moves them, and the code under
  // test speaks the post-0054 vocabulary — so reproduce 0054's effect on the one
  // table this suite exercises rather than editing a historical migration.
  await sql.unsafe(`ALTER TABLE cp_tenant_schema_state RENAME TO cp_workspace_schema_state`)
  await sql.unsafe(`ALTER TABLE cp_workspace_schema_state RENAME COLUMN tenant_id TO workspace_key`)
  __setControlDbForTests(createDbFromSql(sql))
}, 60_000)

afterAll(async () => {
  __setControlDbForTests(null)
  await sql?.end({ timeout: 5 }).catch(() => {})
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`).catch(() => {})
  await admin?.end({ timeout: 5 }).catch(() => {})
}, 60_000)

beforeEach(async () => {
  await sql`DELETE FROM cp_workspace_schema_state`
  await sql`DELETE FROM cp_tenant_registry`
})

async function register(...ids: string[]) {
  for (const id of ids) await sql`INSERT INTO cp_tenant_registry (tenant_id) VALUES (${id})`
}

describe('claiming', () => {
  it('claims a behind workspace and stamps a lease', async () => {
    await register('t1')
    await seed('t1')
    const claimed = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })
    expect(claimed.map((c) => c.workspaceKey)).toEqual(['t1'])
    expect(claimed[0]!.leaseToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(claimed[0]!.attempts).toBe(1)

    const [row] = await sql`SELECT status, locked_by FROM cp_workspace_schema_state`
    expect(row!.status).toBe('running')
    expect(row!.locked_by).toBe('w1')
  })

  it('does not claim a workspace already at its target', async () => {
    await register('t1')
    await seed('t1')
    const [claim] = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })
    await completeWorkspace(claim!, { version: TARGET, appliedCount: 228, postconditionsOk: true })
    expect(await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })).toEqual([])
  })

  it('refuses to record success BELOW the target, which would make the row unclaimable', async () => {
    // The defect this test found. A migrator whose bundle is older than the
    // target applies everything it has and observes a version below it. Marking
    // that `succeeded` would leave a row the claim predicate
    // (`current_version < target_version`) can never select again, so the
    // rollout reports complete having skipped the workspace.
    await register('t1')
    await seed('t1')
    const [claim] = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })
    expect(
      await completeWorkspace(claim!, { version: OLD, appliedCount: 226, postconditionsOk: true })
    ).toBe(false)
    const [row] = await sql`SELECT status, current_version FROM cp_workspace_schema_state`
    expect(row!.status).toBe('running')
    expect(row!.current_version).toBeNull()
  })

  it('the database refuses a succeeded row below its target too', async () => {
    await register('t1')
    await seed('t1')
    await expect(
      sql`UPDATE cp_workspace_schema_state
             SET status = 'succeeded', current_version = ${OLD}, postconditions_ok = true,
                 last_verified_at = now()`
    ).rejects.toThrow(/success_evidence/)
  })

  it('re-claims a workspace once its target moves ahead of what it reached', async () => {
    await register('t1')
    await seed('t1')
    const [claim] = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })
    await completeWorkspace(claim!, { version: TARGET, appliedCount: 228, postconditionsOk: true })
    expect(await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w2' })).toEqual([])
    await setTargetVersion({ targetVersion: TARGET + 5000, workspaceKeys: ['t1'] })
    const again = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w2' })
    expect(again.map((c) => c.workspaceKey)).toEqual(['t1'])
  })

  it('does not claim a workspace another writer put back to pending while already current', async () => {
    // The one case that reaches the claim's version predicate, and it is the
    // same argument `job_queue` makes for its own second barrier: a row must
    // not be claimable just because some other writer set it to `pending`.
    // Reachable in practice by a hand `UPDATE` during an incident, or by any
    // future control-plane writer.
    //
    // This fixture had to be rebuilt: it originally used `set-target` to
    // produce the pending row, and then `set-target` was fixed to stop
    // resetting already-current workspaces — which quietly stopped the test
    // reaching the predicate at all. A fixture that no longer reaches its
    // branch is the commonest way a test stops being one.
    await register('done')
    await seed('done')
    const [claim] = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })
    await completeWorkspace(claim!, { version: TARGET, appliedCount: 228, postconditionsOk: true })

    await sql`UPDATE cp_workspace_schema_state SET status = 'pending', attempts = 0`
    const [row] =
      await sql`SELECT status, current_version, target_version FROM cp_workspace_schema_state`
    expect(row!.status).toBe('pending')
    expect(Number(row!.current_version)).toBeGreaterThanOrEqual(Number(row!.target_version))

    expect(await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w2' })).toEqual([])
  })

  it('two concurrent migrators take disjoint workspaces', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    await register(...ids)
    for (const id of ids) await seed(id)

    const [left, right] = await Promise.all([
      claimWorkspaces({ limit: 3, leaseMs: 60_000, workerId: 'w1' }),
      claimWorkspaces({ limit: 3, leaseMs: 60_000, workerId: 'w2' }),
    ])
    const all = [...left, ...right].map((c) => c.workspaceKey)
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBeGreaterThan(0)
  })

  it('narrows by cohort, which is how a rollout is staged', async () => {
    await register('canary', 'rest')
    await seed('canary', { cohort: 'canary' })
    await seed('rest')
    const claimed = await claimWorkspaces({
      limit: 5,
      leaseMs: 60_000,
      workerId: 'w1',
      cohort: 'canary',
    })
    expect(claimed.map((c) => c.workspaceKey)).toEqual(['canary'])
  })
})

describe('the fencing token', () => {
  it('refuses a completion from a migrator whose lease was reaped', async () => {
    await register('t1')
    await seed('t1', { maxAttempts: 3 })
    const [claim] = await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'slow' })

    // The reaper takes it back and hands it to someone else.
    await sql`UPDATE cp_workspace_schema_state SET locked_until = now() - interval '1 second'`
    await reapExpiredWorkspaceLeases()
    const [next] = await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'fast' })
    expect(next!.leaseToken).not.toBe(claim!.leaseToken)

    // The original owner finishes and reports success. It must write nothing.
    expect(
      await completeWorkspace(claim!, {
        version: TARGET,
        appliedCount: 228,
        postconditionsOk: true,
      })
    ).toBe(false)
    const [row] = await sql`SELECT status, current_version FROM cp_workspace_schema_state`
    expect(row!.status).toBe('running')
    expect(row!.current_version).toBeNull()
  })

  it('a heartbeat from a lost lease returns false', async () => {
    await register('t1')
    await seed('t1', { maxAttempts: 3 })
    const [claim] = await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'slow' })
    expect(await heartbeatWorkspace(claim!, 60_000)).toBe(true)
    await sql`UPDATE cp_workspace_schema_state SET locked_until = now() - interval '1 second'`
    await reapExpiredWorkspaceLeases()
    expect(await heartbeatWorkspace(claim!, 60_000)).toBe(false)
  })
})

describe('the reaper', () => {
  it('requeues a workspace with attempts left and terminates one without', async () => {
    await register('retry', 'spent')
    await seed('retry', { maxAttempts: 3 })
    await seed('spent', { maxAttempts: 1 })
    await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'doomed' })
    await sql`UPDATE cp_workspace_schema_state SET locked_until = now() - interval '1 second'`

    const reaped = await reapExpiredWorkspaceLeases()
    expect(reaped).toEqual({ requeued: 1, terminated: 1 })

    const rows = await listSchemaState()
    const byId = Object.fromEntries(rows.map((r) => [r.workspaceKey, r]))
    expect(byId.retry!.status).toBe('pending')
    expect(byId.spent!.status).toBe('failed')
    // A poisonous workspace that kills its migrator every time must stop being
    // claimed, or it wakes its workspace database forever.
    expect(byId.spent!.lastError).toContain('no attempts remaining')
  })

  it('never touches a blocked workspace', async () => {
    await register('t1')
    await seed('t1')
    await sql`UPDATE cp_workspace_schema_state SET status = 'blocked', last_error = 'halted'`
    expect(await reapExpiredWorkspaceLeases()).toEqual({ requeued: 0, terminated: 0 })
    expect(await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w' })).toEqual([])
  })
})

describe('evidence', () => {
  it('refuses to record success without a verified post-condition verdict', async () => {
    await register('t1')
    await seed('t1')
    const [claim] = await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'w1' })
    await expect(
      completeWorkspace(claim!, { version: TARGET, appliedCount: 228, postconditionsOk: false })
    ).rejects.toThrow(/not evidence/)
    const [row] = await sql`SELECT status FROM cp_workspace_schema_state`
    expect(row!.status).toBe('running')
  })

  it('the database itself refuses a succeeded row with no evidence', async () => {
    await register('t1')
    await seed('t1')
    // Straight past the application code, which is the point: the CHECK has to
    // hold for a hand-run UPDATE during an incident too.
    await expect(sql`UPDATE cp_workspace_schema_state SET status = 'succeeded'`).rejects.toThrow(
      /success_evidence/
    )
  })

  it('the database refuses a terminal failure with no reason', async () => {
    await register('t1')
    await seed('t1')
    await expect(sql`UPDATE cp_workspace_schema_state SET status = 'failed'`).rejects.toThrow(
      /failure_reason/
    )
  })

  it('records the observation alongside a failure', async () => {
    await register('t1')
    await seed('t1', { maxAttempts: 1 })
    const [claim] = await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'w1' })
    const outcome = await failWorkspace(claim!, 'postconditions violated: an index is INVALID', {
      appliedCount: 228,
      postconditionsOk: false,
    })
    expect(outcome).toBe('failed')
    const [row] = await listSchemaState()
    expect(row!.appliedCount).toBe(228)
    expect(row!.postconditionsOk).toBe(false)
    // The exact state the ledger cannot express: complete, and wrong.
    expect(row!.lastError).toContain('INVALID')
  })
})

describe('intent', () => {
  it('setTargetVersion clears a terminal failure so a rollout can resume', async () => {
    await register('t1')
    await seed('t1', { maxAttempts: 1 })
    const [claim] = await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'w1' })
    await failWorkspace(claim!, 'boom')
    expect((await listSchemaState())[0]!.status).toBe('failed')

    await setTargetVersion({ targetVersion: TARGET, workspaceKeys: ['t1'] })
    const row = (await listSchemaState())[0]!
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(row.lastError).toBeNull()
  })

  it('setTargetVersion does not disturb a workspace that is mid-migration', async () => {
    await register('t1')
    await seed('t1')
    await claimWorkspaces({ limit: 1, leaseMs: 60_000, workerId: 'w1' })
    await setTargetVersion({ targetVersion: TARGET + 5000, workspaceKeys: ['t1'] })
    const row = (await listSchemaState())[0]!
    expect(row.status).toBe('running')
    expect(row.attempts).toBe(1)
    expect(row.targetVersion).toBe(TARGET + 5000)
  })

  it('setTargetVersion leaves an already-current workspace `succeeded`, not `pending`', async () => {
    // Re-issuing the same target used to reset every non-running row to
    // `pending`, so `status` reported a fleet full of work that would never be
    // claimed — the claim narrows on `current_version < target_version`, so
    // correctness held and only the operator-facing column lied. During a
    // rollout that column is the thing people read.
    await register('done', 'behind')
    await seed('done')
    await seed('behind')
    const claimed = await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w1' })
    await completeWorkspace(claimed.find((c) => c.workspaceKey === 'done')!, {
      version: TARGET,
      appliedCount: 228,
      postconditionsOk: true,
    })
    await failWorkspace(claimed.find((c) => c.workspaceKey === 'behind')!, 'transient')

    await setTargetVersion({ targetVersion: TARGET })

    const byId = Object.fromEntries((await listSchemaState()).map((r) => [r.workspaceKey, r]))
    expect(byId.done!.status).toBe('succeeded')
    expect(byId.behind!.status).toBe('pending')
    expect(await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w2' })).toEqual([
      expect.objectContaining({ workspaceKey: 'behind' }),
    ])
  })

  it('setTargetVersion does NOT un-block a deliberately blocked workspace', async () => {
    // A block is a human decision — a halted rollout, a workspace under
    // investigation, a fixture somebody needs to stay behind. An earlier
    // version reset `blocked` to `pending` on any target write, so a routine
    // bump silently re-enrolled it AND cleared the reason recorded for the
    // block. Both halves are asserted, because restoring only the status would
    // leave the operator's note gone.
    await register('halted')
    await seed('halted')
    await blockWorkspace('halted', 'under investigation')

    await setTargetVersion({ targetVersion: TARGET + 5000 })

    const row = (await listSchemaState())[0]!
    expect(row.status).toBe('blocked')
    expect(row.lastError).toBe('under investigation')
    expect(row.targetVersion).toBe(TARGET + 5000)
    expect(await claimWorkspaces({ limit: 5, leaseMs: 60_000, workerId: 'w' })).toEqual([])
  })

  it('ensureSchemaStateRow never lowers an existing target', async () => {
    await register('t1')
    await seed('t1')
    await setTargetVersion({ targetVersion: TARGET + 5000, workspaceKeys: ['t1'] })
    expect(await ensureSchemaStateRow({ workspaceKey: 't1', targetVersion: OLD })).toBe(false)
    expect((await listSchemaState())[0]!.targetVersion).toBe(TARGET + 5000)
  })
})
