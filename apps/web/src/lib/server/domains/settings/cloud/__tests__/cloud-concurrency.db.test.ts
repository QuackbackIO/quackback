/**
 * The lost update between the two writers of `settings.cloud`, closed.
 *
 * ## The bug this exists to prove gone
 *
 * `settings.cloud` is one JSON column with two independent read-modify-write
 * writers: the declarative config file's reconciler and the billing module.
 * The naive implementation read the row, merged in memory, and wrote the whole
 * column back. Interleave two of those and the later write is computed from a
 * value that is already stale:
 *
 *     T0  reconciler reads  { plan: 'pro' }
 *     T1  billing writes    { plan: 'pro', billing.subscriptionRef: 'sub_1' }
 *     T2  reconciler writes { plan: 'business' }        <- subscriptionRef gone
 *
 * Nothing errors, nothing logs, and the workspace's subscription reference is
 * simply absent. That is the failure this file reproduces and then proves
 * impossible.
 *
 * ## Why it needs a real database and two connections
 *
 * The fix is `SELECT … FOR UPDATE` inside a transaction. A mocked executor
 * cannot express row locking, and the shared rollback fixture
 * (`db-test-fixture.ts`) parks every statement inside ONE transaction, where
 * two "concurrent" writers would not contend at all — a test built on it
 * would pass whether or not the lock existed. So this file opens two real
 * connections and drives the real `writeCloudConfig` down each.
 *
 * ## Isolation
 *
 * Both connections work in a private schema holding a structural copy of
 * `public.settings` (`CREATE TABLE … LIKE public.settings INCLUDING ALL`), put
 * first on the `search_path`. Drizzle emits unqualified table names, so the
 * real code hits the copy. That keeps this file from colliding with any other
 * suite sharing `quackback_test`, and — because the DDL is copied rather than
 * hand-written — the table cannot drift from the real one.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
// eslint-disable-next-line no-restricted-imports -- sanctioned direct client use, as in db-test-fixture.ts
import { createDb, type Database } from '@quackback/db/client'

const SCHEMA = 'billing_lostupdate_test'
const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'

/** Which connection the code under test should use, per async context. */
const connectionStore = new AsyncLocalStorage<Database>()

let alpha: Database | null = null
let beta: Database | null = null
let available = false

/**
 * The global `db`, resolved per async context. Two writers running
 * concurrently therefore genuinely use two connections, which is the only way
 * row locking can be observed at all.
 */
const routedDb = new Proxy({} as Database, {
  get(_target, prop) {
    const active = connectionStore.getStore() ?? alpha
    if (!active) throw new Error('cloud-concurrency: no connection bound')
    const value = (active as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(active)
      : value
  },
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  get db() {
    return routedDb
  },
}))

// The settings cache is Redis-backed; this suite is about the column.
vi.mock('../../settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))

const { writeCloudConfig } = await import('../cloud.service')
const { settings } = await import('@/lib/server/db')

async function bootstrap(): Promise<boolean> {
  const admin = createDb(URL, { max: 1, prepare: false })
  try {
    await admin.execute(sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`))
    await admin.execute(sql.raw(`CREATE SCHEMA ${SCHEMA}`))
    // Structural copy of the real table, defaults and constraints included, so
    // this suite exercises the shipped DDL rather than a restatement of it.
    await admin.execute(
      sql.raw(`CREATE TABLE ${SCHEMA}.settings (LIKE public.settings INCLUDING ALL)`)
    )
    // Proves the migration landed. Without it the suite would silently test a
    // table with no cloud_revision column and pass for the wrong reason.
    await admin.execute(sql.raw(`SELECT cloud, cloud_revision FROM ${SCHEMA}.settings LIMIT 0`))
    return true
  } catch {
    return false
  } finally {
    await (admin as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
  }
}

/**
 * Bootstrapped at module top level, NOT in `beforeAll`.
 *
 * `describe.skipIf(...)` is evaluated when the describe block is registered,
 * which happens before any hook runs — so a flag set in `beforeAll` is still
 * false at that moment and the whole suite skips silently. That is precisely
 * the shape of a test that cannot fail, and it was the first thing this file
 * did wrong.
 */
available = await bootstrap()

if (available) {
  // max: 1 so the pool holds exactly one backend and the session-level SET
  // below applies to every subsequent statement on it.
  alpha = createDb(URL, { max: 1, prepare: false })
  beta = createDb(URL, { max: 1, prepare: false })
  for (const connection of [alpha, beta]) {
    await connection.execute(sql.raw(`SET search_path = ${SCHEMA}, public`))
    // A block here means another suite holds a conflicting lock. Fail fast
    // and loudly rather than hanging the whole run.
    await connection.execute(sql`SET lock_timeout = '10s'`)
    // Verify the precondition rather than assume it. `createDb` ignores
    // unknown options, so an earlier attempt to pass search_path through the
    // client factory was silently dropped and this suite ran against the
    // REAL public.settings — passing its first assertion for entirely the
    // wrong reason, and leaving a row behind in the shared database.
    const [row] = (await connection.execute(sql`SELECT current_schema() AS schema`)) as unknown as [
      { schema: string },
    ]
    if (row?.schema !== SCHEMA) {
      throw new Error(
        `cloud-concurrency: search_path did not take effect (current_schema=${row?.schema}); ` +
          'refusing to run against the shared public schema'
      )
    }
  }
}

afterAll(async () => {
  for (const connection of [alpha, beta]) {
    await (connection as unknown as { $client?: { end?: () => Promise<void> } })?.$client?.end?.()
  }
  alpha = null
  beta = null
  if (!available) return
  const admin = createDb(URL, { max: 1, prepare: false })
  await admin.execute(sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`))
  await (admin as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
})

beforeEach(async () => {
  if (!available || !alpha) return
  await alpha.execute(sql.raw(`TRUNCATE ${SCHEMA}.settings`))
  await alpha.insert(settings).values({
    name: 'Concurrency',
    slug: 'concurrency',
    createdAt: new Date(),
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function readCloud(): Promise<{
  cloud: Record<string, unknown> | null
  revision: number
}> {
  const [row] = await alpha!
    .select({ cloud: settings.cloud, revision: settings.cloudRevision })
    .from(settings)
    .limit(1)
  return { cloud: (row?.cloud ?? null) as Record<string, unknown> | null, revision: row?.revision ?? 0 }
}

/** Run `fn` with the code under test bound to `connection`. */
function on<T>(connection: Database, fn: () => Promise<T>): Promise<T> {
  return connectionStore.run(connection, fn)
}

describe.skipIf(!available)('settings.cloud under two concurrent writers', () => {
  it('keeps both writes when a billing write and a config reconcile interleave', async () => {
    // The exact interleave from the module docs: the config writer sets a
    // plan, the billing writer sets a subscription reference, and they run at
    // the same time on different connections.
    await Promise.all([
      on(alpha!, () =>
        writeCloudConfig({ enabled: true, plan: 'business' }, { writer: 'config' })
      ),
      on(beta!, () =>
        writeCloudConfig(
          { billing: { provider: 'stripe', subscriptionRef: 'sub_1' } },
          { writer: 'billing' }
        )
      ),
    ])

    const { cloud, revision } = await readCloud()
    // Both survive. Which one wrote *last* is genuinely unspecified — that is
    // what concurrency means — but neither may erase the other's field.
    expect(cloud).toMatchObject({
      enabled: true,
      plan: 'business',
      billing: expect.objectContaining({ provider: 'stripe', subscriptionRef: 'sub_1' }),
    })
    // Two effective writes, two revisions. A lost update would show as 1.
    expect(revision).toBe(2)
  })

  it('keeps every write when many writers pile onto the same column', async () => {
    // Eight writers, each claiming a distinct field, alternating connections.
    // A single lost update anywhere leaves a hole, and the assertion is on
    // the whole resulting object rather than on a count.
    const writes = [
      on(alpha!, () => writeCloudConfig({ enabled: true }, { writer: 'config' })),
      on(beta!, () => writeCloudConfig({ plan: 'pro' }, { writer: 'billing' })),
      on(alpha!, () =>
        writeCloudConfig({ entitlements: { sso: true } }, { writer: 'config' })
      ),
      on(beta!, () =>
        writeCloudConfig({ billing: { customerRef: 'cus_1' } }, { writer: 'billing' })
      ),
      on(alpha!, () =>
        writeCloudConfig({ billing: { subscriptionRef: 'sub_1' } }, { writer: 'billing' })
      ),
      on(beta!, () => writeCloudConfig({ billing: { status: 'active' } }, { writer: 'billing' })),
      on(alpha!, () =>
        writeCloudConfig({ entitlements: { auditLog: true } }, { writer: 'config' })
      ),
      on(beta!, () =>
        writeCloudConfig({ upgradeUrl: 'https://example.test/billing' }, { writer: 'config' })
      ),
    ]
    await Promise.all(writes)

    const { cloud, revision } = await readCloud()
    expect(cloud).toMatchObject({
      enabled: true,
      plan: 'pro',
      entitlements: { sso: true, auditLog: true },
      billing: expect.objectContaining({
        customerRef: 'cus_1',
        subscriptionRef: 'sub_1',
        status: 'active',
      }),
      upgradeUrl: 'https://example.test/billing',
    })
    expect(revision).toBe(8)
  })

  it('does not bump the revision for a write that changes nothing', async () => {
    // Idempotence is load-bearing, not cosmetic: the config reconciler polls
    // every 30 seconds and the provider redelivers webhooks. Without this,
    // every tick would rewrite the row and bust the settings cache forever.
    await on(alpha!, () => writeCloudConfig({ enabled: true, plan: 'pro' }, { writer: 'config' }))
    const first = await readCloud()

    const result = await on(beta!, () =>
      writeCloudConfig({ enabled: true, plan: 'pro' }, { writer: 'config' })
    )
    const second = await readCloud()

    expect(result.changed).toBe(false)
    expect(second.revision).toBe(first.revision)
    expect(second.cloud).toEqual(first.cloud)
  })

  it('refuses a write carrying a stale revision', async () => {
    // The other half of the guard, for a caller that read in one request and
    // wrote in another — a UI form, not a server-side reconciler.
    await on(alpha!, () => writeCloudConfig({ enabled: true, plan: 'pro' }, { writer: 'config' }))
    const stale = (await readCloud()).revision

    await on(beta!, () => writeCloudConfig({ plan: 'business' }, { writer: 'billing' }))

    await expect(
      on(alpha!, () =>
        writeCloudConfig({ plan: 'free' }, { writer: 'billing', expectedRevision: stale })
      )
    ).rejects.toThrow(/changed in another session/i)

    // And the refusal left the winner's value alone.
    expect((await readCloud()).cloud).toMatchObject({ plan: 'business' })
  })

  it('accepts a write carrying the current revision', async () => {
    await on(alpha!, () => writeCloudConfig({ enabled: true, plan: 'pro' }, { writer: 'config' }))
    const current = (await readCloud()).revision
    const result = await on(beta!, () =>
      writeCloudConfig({ plan: 'business' }, { writer: 'billing', expectedRevision: current })
    )
    expect(result).toEqual({ changed: true, revision: current + 1 })
  })
})
