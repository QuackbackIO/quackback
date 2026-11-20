/**
 * Real-Postgres proof that a settings read racing a settings write never
 * leaves the old settings in the cache.
 *
 * A read that misses the cache reads the settings row, builds the workspace
 * settings (more awaits) and then caches them for an hour. A write that
 * commits and drops the cache while that read is between its row read and its
 * cache fill used to be undone by the fill: the old row went back into the
 * cache after the drop, and every page served the old value for the hour. An
 * admin who switched a setting on and reloaded saw it switched off again.
 *
 * The racing connections have to see the rows, so `settings` and `kv_store`
 * are copied into a schema of this suite's own.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'

const race = vi.hoisted(() => ({
  schema: `settings_fill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
  // Holds a cache-missing read after it has read the settings row and before
  // it fills the cache.
  gate: null as null | { reached: () => void; release: Promise<void> },
}))

// Domain code imports the global `db`; point it at this suite's schema.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const target = race.db as Record<string | symbol, unknown>
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }
  ),
}))

// Awaited by the settings read after its row read and before its cache fill.
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: async () => {
    const gate = race.gate
    if (gate) {
      race.gate = null
      gate.reached()
      await gate.release
    }
    return new Set<string>()
  },
  getPlatformCredentials: async () => null,
}))

import { createDbOnConnection, db, settings, sql } from '@/lib/server/db'
import { CACHE_KEYS } from '@/lib/server/cache'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { getWorkspaceSettingsRow } from '../settings.service'
import { invalidateSettingsCache } from '../settings.helpers'
import {
  getWorkflowAbandonedAutoCloseSettings,
  updateWorkflowAbandonedAutoCloseSettings,
} from '../settings.workflows'

// This proof needs Postgres. Without a database URL it is skipped under a
// name that says so; with one, a setup failure fails the file rather than
// passing it quietly.
const DATABASE_URL = process.env.DATABASE_URL
let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
if (DATABASE_URL) {
  admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  await admin.unsafe(`create table ${race.schema}.settings (like public.settings including all)`)
  await admin.unsafe(`create table ${race.schema}.kv_store (like public.kv_store including all)`)
  pool = postgres(DATABASE_URL, {
    max: 6,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public` },
  })
  race.db = createDbOnConnection(pool)
}

afterAll(async () => {
  await pool?.end()
  await admin?.unsafe(`drop schema if exists ${race.schema} cascade`).catch(() => {})
  await admin?.end()
})

const COMPLETE_SETUP = JSON.stringify({
  version: 2,
  steps: {
    core: true,
    workspace: true,
    startingPoint: {
      outcome: 'product_feedback',
      resourceType: 'none',
      source: 'managed',
      resolution: 'configured',
      completedAt: '2026-08-13T00:00:00.000Z',
    },
  },
})

beforeEach(async () => {
  if (!DATABASE_URL) return
  race.gate = null
  await db.execute(sql`delete from kv_store`)
  await db.delete(settings)
  await db.insert(settings).values({
    name: 'Stale fill',
    slug: 'stale-fill',
    createdAt: new Date(),
    setupState: COMPLETE_SETUP,
    metadata: null,
  })
})

/** A settings read that stops after its row read until `release` is called. */
async function startHeldRead() {
  let release!: () => void
  let reached!: () => void
  const atGate = new Promise<void>((resolve) => (reached = resolve))
  race.gate = { reached, release: new Promise<void>((resolve) => (release = resolve)) }
  const read = getWorkspaceSettingsRow()
  await atGate
  return { release, read }
}

async function cachedMetadata(): Promise<string | null | undefined> {
  const [row] = getExecuteRows<{ metadata: string | null }>(
    await db.execute(sql`
      select value -> 'settings' ->> 'metadata' as metadata from kv_store
      where key = ${CACHE_KEYS.WORKSPACE_SETTINGS}`)
  )
  return row ? row.metadata : undefined
}

describe.skipIf(!DATABASE_URL)('settings cache fill racing a settings write', () => {
  it('a read that read the row before a save does not cache the old row after it', async () => {
    const held = await startHeldRead()

    await updateWorkflowAbandonedAutoCloseSettings({ enabled: true })

    held.release()
    await held.read

    // The next read (the admin's reload) sees the save.
    expect((await getWorkflowAbandonedAutoCloseSettings()).enabled).toBe(true)
  })

  it('a fill does not wait on a save still in flight, and that save drops what it cached', async () => {
    const held = await startHeldRead()

    // The save has written the row and not yet committed when the read fills.
    const conn = await pool!.reserve()
    try {
      await conn`begin`
      await conn`update settings set metadata = ${JSON.stringify({
        workflowAbandonedAutoClose: { enabled: true },
      })}`

      held.release()
      // The fill must not wait for the save: it takes no lock on the row.
      await withTimeout(held.read, 5_000, 'the fill waited on the save')
      await conn`commit`
    } finally {
      await conn`rollback`.catch(() => {})
      conn.release()
    }
    // Every settings writer drops the cache after its commit.
    await invalidateSettingsCache()

    expect((await getWorkflowAbandonedAutoCloseSettings()).enabled).toBe(true)
  })

  it('a fill holds no lock a save would wait on', async () => {
    const held = await startHeldRead()

    // Another connection is part way through writing the cache entry, so the
    // fill queues behind it mid-statement.
    const cacheWriter = await pool!.reserve()
    const save = await pool!.reserve()
    try {
      await cacheWriter`begin`
      const [{ pid }] = await cacheWriter<{ pid: number }[]>`select pg_backend_pid() as pid`
      await cacheWriter`
        insert into kv_store (workspace_key, key, value, expires_at)
        values ('_', ${CACHE_KEYS.WORKSPACE_SETTINGS}, 'null'::jsonb, now() + interval '1 hour')
        on conflict do nothing`
      held.release()
      await waitForBlockedBy(pid)

      // While the fill waits, a save can still take the settings row at once.
      await save`begin`
      await expect(save`select id from settings limit 1 for update nowait`).resolves.toHaveLength(1)
      await save`rollback`
      await cacheWriter`rollback`
      await held.read
    } finally {
      // Leave no transaction open on a pooled connection, pass or fail.
      await save`rollback`.catch(() => {})
      await cacheWriter`rollback`.catch(() => {})
      save.release()
      cacheWriter.release()
    }
  })

  it('a read with no write in between still fills the cache', async () => {
    await getWorkspaceSettingsRow()
    expect(await cachedMetadata()).toBeNull()
  })
})

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Wait until a session queues behind the backend `pid`. */
async function waitForBlockedBy(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const [{ blocked }] = getExecuteRows<{ blocked: number }>(
      await db.execute(sql`
        select count(*)::int as blocked from pg_stat_activity
        where ${pid} = any(pg_blocking_pids(pid))`)
    )
    if (blocked >= 1) return
    if (Date.now() > deadline) throw new Error(`nothing queued behind ${pid}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}
