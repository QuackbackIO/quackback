/**
 * The self-hosted boot migration stops on a held table lock instead of waiting.
 *
 * `migrate.ts` is what the container runs at every start. A migration that needs
 * a lock another session holds (a long query, an open transaction) waits the same
 * 30 seconds the fleet migrator does rather than for as long as that session
 * keeps it, fails with a lock timeout error that says what happened, and the next
 * start applies the migrations once the lock is gone.
 *
 * The CLI itself is run, as the container runs it, against its own scratch
 * database. The lineage is one transaction, so the failed start changes nothing.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { DEFAULT_MIGRATE_LOCK_TIMEOUT_MS, runMigrations } from '../migrate-runtime'
import { BUNDLED_MIGRATIONS, readAppliedLedger, truncateAppliedLedger } from '../schema-version'

const ADMIN_URL =
  process.env.DRIFT_CHECK_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/postgres'
const DB = `qb_lock_timeout_${randomUUID().replace(/-/g, '').slice(0, 10)}`
const dsn = ADMIN_URL.replace(/\/[^/]+$/, `/${DB}`)
const PACKAGE_DIR = path.resolve(__dirname, '../..')

/** The journal timestamp of the job queue migration, which touches `job_queue` first. */
const JOB_QUEUE_WHEN = BUNDLED_MIGRATIONS.find((m) => m.tag.startsWith('0250_'))!.when

let admin: postgres.Sql

interface BootResult {
  code: number | null
  output: string
  ms: number
  /** True when the test had to kill a boot that was still waiting. */
  killed: boolean
}

/** Run the boot migration CLI, killing it if it is still running after `limitMs`. */
function boot(limitMs: number): Promise<BootResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn('bun', ['src/migrate.ts'], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: dsn },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += String(chunk)))
    child.stderr.on('data', (chunk) => (output += String(chunk)))
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, limitMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, output, ms: Date.now() - started, killed })
    })
  })
}

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${DB}`)
  await runMigrations(dsn, { requireSessionMode: false })
}, 240_000)

afterAll(async () => {
  // Dropping a database waits for a checkpoint, which a loaded server can take minutes over.
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => {})
  await admin?.end({ timeout: 5 }).catch(() => {})
}, 180_000)

describe('the self-hosted boot migration', () => {
  it('uses the fleet migrator lock timeout of 30 seconds', () => {
    expect(DEFAULT_MIGRATE_LOCK_TIMEOUT_MS).toBe(30_000)
  })

  it('stops with a lock timeout error on a held lock, and the next start succeeds', async () => {
    const sql = postgres(dsn, { max: 1, onnotice: () => {} })
    const holder = postgres(dsn, { max: 1, onnotice: () => {} })
    try {
      // Pending migrations from the job queue migration onwards, as after an
      // upgrade, while another session holds the table the first one alters.
      await truncateAppliedLedger(sql, JOB_QUEUE_WHEN)
      await holder.unsafe('BEGIN')
      await holder.unsafe('LOCK TABLE job_queue IN ACCESS EXCLUSIVE MODE')

      const blocked = await boot(DEFAULT_MIGRATE_LOCK_TIMEOUT_MS + 30_000)
      expect(blocked.killed, blocked.output).toBe(false)
      expect(blocked.code).toBe(1)
      expect(blocked.ms).toBeGreaterThanOrEqual(DEFAULT_MIGRATE_LOCK_TIMEOUT_MS - 1_000)
      expect(blocked.output).toMatch(/lock timeout/i)
      expect((await readAppliedLedger(sql)).versions.has(JOB_QUEUE_WHEN)).toBe(false)

      await holder.unsafe('ROLLBACK')
      const next = await boot(120_000)
      expect(next.code, next.output).toBe(0)
      expect((await readAppliedLedger(sql)).versions.has(JOB_QUEUE_WHEN)).toBe(true)
    } finally {
      await holder.unsafe('ROLLBACK').catch(() => {})
      await holder.end({ timeout: 5 }).catch(() => {})
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  }, 240_000)
})
