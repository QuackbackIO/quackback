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
import {
  getWorkflowAbandonedAutoCloseSettings,
  updateWorkflowAbandonedAutoCloseSettings,
} from '../settings.workflows'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  await admin.unsafe(`create table ${race.schema}.settings (like public.settings including all)`)
  await admin.unsafe(`create table ${race.schema}.kv_store (like public.kv_store including all)`)
  pool = postgres(url, {
    max: 6,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public` },
  })
  race.db = createDbOnConnection(pool)
  // A stale test database (a column the schema declares but no migration
  // added yet) skips the suite rather than failing it mid-test.
  await db.select().from(settings).limit(0)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
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
  if (!available) return
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

describe.skipIf(!available)('settings cache fill racing a settings write', () => {
  it('a read that read the row before a save does not cache the old row after it', async () => {
    const held = await startHeldRead()

    await updateWorkflowAbandonedAutoCloseSettings({ enabled: true })

    held.release()
    await held.read

    // The next read (the admin's reload) sees the save.
    expect((await getWorkflowAbandonedAutoCloseSettings()).enabled).toBe(true)
  })

  it('a fill while a save still holds the row does not cache the old row', async () => {
    const held = await startHeldRead()

    // The save holds the row and has not committed when the read fills.
    const conn = await pool!.reserve()
    try {
      await conn`begin`
      await conn`update settings set metadata = ${JSON.stringify({
        workflowAbandonedAutoClose: { enabled: true },
      })}`

      held.release()
      // The fill neither waits for the save nor caches the row it replaces.
      await held.read
      await conn`commit`
    } finally {
      conn.release()
    }

    expect(await cachedMetadata()).toBeUndefined()
    expect((await getWorkflowAbandonedAutoCloseSettings()).enabled).toBe(true)
  })

  it('a read with no write in between still fills the cache', async () => {
    await getWorkspaceSettingsRow()
    expect(await cachedMetadata()).toBeNull()
  })
})
