/**
 * Real-Postgres proof that writes to the shared `settings.metadata` bag are
 * atomic and never drop what they cannot read.
 *
 * The bag is one text column that many unrelated writers keep a key in, so a
 * writer that reads it, changes its own key and writes the whole blob back
 * loses every key another writer committed in between, and a writer that
 * treats an unreadable blob as empty erases them all.
 *
 * The racing connections have to see the row, so it is committed, into a copy
 * of `settings` in a schema of this suite's own: no other suite can read what
 * it commits, and `findFirst()` on it sees only this suite's row.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import type { Transaction } from '@/lib/server/db'

const race = vi.hoisted(() => ({
  schema: `settings_meta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
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

const cache = vi.hoisted(() => ({ del: vi.fn(async (..._keys: string[]) => {}) }))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: cache.del,
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connections rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, settings, sql } from '@/lib/server/db'
import { CACHE_KEYS } from '@/lib/server/cache'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { InternalError } from '@/lib/shared/errors'
import { writeMetadataKey } from '../settings.helpers'
import { updateFeatureFlags } from '../settings.service'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  await admin.unsafe(`create table ${race.schema}.settings (like public.settings including all)`)
  pool = postgres(url, {
    max: 6,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public` },
  })
  race.db = createDbFromSql(pool)
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

const SETTINGS_KEYS = [CACHE_KEYS.WORKSPACE_SETTINGS, CACHE_KEYS.REGISTERED_AUTH_PROVIDERS]

const FLAGS_OFF = JSON.stringify({
  feedback: true,
  changelog: true,
  helpCenter: false,
  supportInbox: false,
  supportTickets: false,
  statusPage: false,
})

async function seed(metadata: string | null): Promise<void> {
  await db.delete(settings)
  await db.insert(settings).values({
    name: 'Metadata writes',
    slug: 'metadata-writes',
    createdAt: new Date(),
    featureFlags: FLAGS_OFF,
    metadata,
  })
}

async function stored(): Promise<{ metadata: string | null; featureFlags: string | null }> {
  const [row] = await db
    .select({ metadata: settings.metadata, featureFlags: settings.featureFlags })
    .from(settings)
  return row
}

async function storedBag(): Promise<Record<string, unknown>> {
  return JSON.parse((await stored()).metadata ?? '{}') as Record<string, unknown>
}

/**
 * Wait until `count` sessions queue behind the backend `pid`. A second waiter
 * on a row queues behind the first, so the chain is followed, not one hop.
 */
async function waitForBlockedBy(pid: number, count: number): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const [{ blocked }] = getExecuteRows<{ blocked: number }>(
      await db.execute(sql`
        with recursive waiting(pid) as (
          select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
          union
          select a.pid from pg_stat_activity a join waiting w on w.pid = any(pg_blocking_pids(a.pid))
        )
        select count(*)::int as blocked from waiting
      `)
    )
    if (blocked >= count) return
    if (Date.now() > deadline)
      throw new Error(`only ${blocked} of ${count} writers reached the row`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Run `writers` while a third connection holds the settings row, and release
 * it only once every writer is waiting on it.
 *
 * Two writers only race if both have started before either commits, which a
 * plain Promise.all leaves to chance. Holding the row makes the interleaving
 * certain: a writer that reads the bag without the row lock has already read
 * it by the time it queues (on its UPDATE), while one that takes the lock
 * queues before reading and so reads whatever the previous holder committed.
 * `during` runs inside the holder's transaction, as another writer would.
 */
async function behindHeldRow<T>(
  writers: Array<() => Promise<T>>,
  during?: (tx: Transaction) => Promise<void>
): Promise<T[]> {
  let releaseRow!: () => void
  const rowReleased = new Promise<void>((resolve) => (releaseRow = resolve))
  let reportPid!: (pid: number) => void
  const holderPid = new Promise<number>((resolve) => (reportPid = resolve))
  const holding = db.transaction(async (tx) => {
    await tx.select({ id: settings.id }).from(settings).limit(1).for('update')
    await during?.(tx)
    const [{ pid }] = getExecuteRows<{ pid: number }>(
      await tx.execute(sql`select pg_backend_pid() as pid`)
    )
    reportPid(pid)
    await rowReleased
  })
  const pid = await Promise.race([
    holderPid,
    holding.then(() => Promise.reject(new Error('the row holder ended before holding'))),
  ])

  const racing = Promise.all(writers.map((write) => write()))
  try {
    await waitForBlockedBy(pid, writers.length)
  } finally {
    releaseRow()
    await holding
  }
  return racing
}

describe.skipIf(!available)('settings.metadata writes', () => {
  beforeEach(() => {
    cache.del.mockClear()
  })

  describe('concurrent writers', () => {
    it('keeps both keys when two writers change different keys at once', async () => {
      await seed(JSON.stringify({ instanceId: 'inst_1' }))

      await behindHeldRow<unknown>([
        () => writeMetadataKey('officeHours', { enabled: true, timezone: 'UTC', intervals: [] }),
        () => writeMetadataKey('defaultSlaPolicy', { policyId: null }),
      ])

      expect(await storedBag()).toEqual({
        instanceId: 'inst_1',
        officeHours: { enabled: true, timezone: 'UTC', intervals: [] },
        defaultSlaPolicy: { policyId: null },
      })
    })

    it('keeps a key written while turning Status on through the feature flags', async () => {
      await seed(JSON.stringify({ instanceId: 'inst_1' }))

      await behindHeldRow<unknown>([
        () => updateFeatureFlags({ statusPage: true }),
        () => writeMetadataKey('emailAutoAck', { enabled: true }),
      ])

      const bag = await storedBag()
      expect(bag.instanceId).toBe('inst_1')
      expect(bag.emailAutoAck).toEqual({ enabled: true })
      expect(bag.statusSettings).toMatchObject({ enabled: true })
      expect(JSON.parse((await stored()).featureFlags ?? '{}')).toMatchObject({
        statusPage: true,
      })
    })

    it('computes the functional form from the row it writes, not an earlier read', async () => {
      await seed(JSON.stringify({ tally: { n: 1 }, keep: 'x' }))
      const seen: Array<string | null> = []

      const [written] = await behindHeldRow(
        [
          () =>
            writeMetadataKey('tally', (metadata) => {
              seen.push(metadata)
              const bag = JSON.parse(metadata ?? '{}') as { tally: { n: number } }
              return { n: bag.tally.n + 1 }
            }),
        ],
        // Another writer commits while this one waits for the row.
        async (tx) => {
          await tx
            .update(settings)
            .set({ metadata: JSON.stringify({ tally: { n: 5 }, keep: 'x', other: 'y' }) })
        }
      )

      expect(seen).toEqual([JSON.stringify({ tally: { n: 5 }, keep: 'x', other: 'y' })])
      expect(written).toEqual({ n: 6 })
      expect(await storedBag()).toEqual({ tally: { n: 6 }, keep: 'x', other: 'y' })
    })
  })

  describe('a stored bag that is not a JSON object', () => {
    const unreadable = ['{"instanceId":"inst_1"', 'not json', '[1,2]', '"text"', '42', 'true']

    it.each(unreadable)('refuses a key write over %j and leaves it as stored', async (bad) => {
      await seed(bad)
      const compute = vi.fn(() => ({ enabled: true }))

      const error = await writeMetadataKey('emailAutoAck', compute).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(InternalError)
      expect((error as InternalError).code).toBe('SETTINGS_METADATA_INVALID')
      expect(compute).not.toHaveBeenCalled()
      expect((await stored()).metadata).toBe(bad)
      expect(cache.del).not.toHaveBeenCalled()
    })

    it.each(unreadable)('refuses to turn Status on over %j and writes nothing', async (bad) => {
      await seed(bad)

      const error = await updateFeatureFlags({ statusPage: true }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(InternalError)
      expect((error as InternalError).code).toBe('SETTINGS_METADATA_INVALID')
      expect(await stored()).toEqual({ metadata: bad, featureFlags: FLAGS_OFF })
      expect(cache.del).not.toHaveBeenCalled()
    })

    it('still writes the other flags when Status is not being turned on', async () => {
      await seed('not json')

      await updateFeatureFlags({ changelog: false })

      expect(await stored()).toEqual({
        metadata: 'not json',
        featureFlags: expect.stringContaining('"changelog":false'),
      })
    })
  })

  describe('an absent bag', () => {
    it.each([null, '', '  ', 'null'])('starts a new bag over %j', async (absent) => {
      await seed(absent)

      await expect(writeMetadataKey('emailAutoAck', { enabled: true })).resolves.toEqual({
        enabled: true,
      })

      expect(await storedBag()).toEqual({ emailAutoAck: { enabled: true } })
    })
  })

  it('invalidates the settings cache only once the write is visible to other connections', async () => {
    await seed(JSON.stringify({ instanceId: 'inst_1' }))
    const visibleAtInvalidation: Array<string | null> = []
    cache.del.mockImplementationOnce(async () => {
      const [row] = await admin!.unsafe<Array<{ metadata: string | null }>>(
        `select metadata from ${race.schema}.settings limit 1`
      )
      visibleAtInvalidation.push(row?.metadata ?? null)
    })

    await writeMetadataKey('emailAutoAck', { enabled: true })

    expect(cache.del).toHaveBeenCalledTimes(1)
    expect(cache.del).toHaveBeenCalledWith(...SETTINGS_KEYS)
    expect(JSON.parse(visibleAtInvalidation[0] ?? '{}')).toEqual({
      instanceId: 'inst_1',
      emailAutoAck: { enabled: true },
    })
  })
})
