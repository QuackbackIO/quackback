/**
 * Real-Postgres proof that a publish and a single-part settings save that
 * land at the same moment keep each other's change.
 *
 * The publish locks the settings row. A single-part writer (an access save
 * through updatePortalConfig, say) that read the row without the lock would
 * write back the portal config it read before the publish committed, and the
 * just-published tabs would be gone. The racing connections have to see the
 * row, so it is committed into copies of `settings` and `audit_log` in a
 * schema of this suite's own, dropped afterwards.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'

const race = vi.hoisted(() => ({
  schema: `portal_publish_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(async () => {}),
}))

// The db test fixture re-exports its sanctioned direct client import: this suite
// builds its own connections rather than going through the global `db`.
import { createDbFromSql } from '@/lib/server/__tests__/db-test-fixture'
import { db, settings, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { publishPortalCustomisation } from '../portal-customise.service'
import { updatePortalConfig } from '../settings.service'
import { invalidateTierLimitsCache } from '../tier-limits.service'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  await admin.unsafe(`create table ${race.schema}.settings (like public.settings including all)`)
  await admin.unsafe(`create table ${race.schema}.audit_log (like public.audit_log including all)`)
  pool = postgres(url, {
    max: 6,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public` },
  })
  race.db = createDbFromSql(pool)
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

const loadedNav = { items: [{ id: 'feedback', type: 'feedback' }] }
const publishedNav = { items: [{ id: 'roadmap', type: 'roadmap' as const }] }

async function storedPortal(): Promise<Record<string, unknown>> {
  const [row] = await db.select({ portalConfig: settings.portalConfig }).from(settings)
  return JSON.parse(row.portalConfig ?? '{}') as Record<string, unknown>
}

/** Sessions currently queued (directly or down a chain) behind backend `pid`. */
async function blockedBy(pid: number): Promise<number> {
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
  return blocked
}

async function waitForBlockedBy(pid: number, count: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while ((await blockedBy(pid)) < count) {
    if (Date.now() > deadline) throw new Error(`fewer than ${count} writers reached the row`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.skipIf(!available)('a publish racing a single-part save', () => {
  it('keeps the published tabs and the access change made at the same moment', async () => {
    invalidateTierLimitsCache()
    await db.delete(settings)
    await db.insert(settings).values({
      name: 'Race',
      slug: 'race',
      createdAt: new Date(),
      portalConfig: JSON.stringify({ nav: loadedNav }),
    })

    // A third connection holds the row so both writers start before either
    // commits; the publish queues first, then the access save.
    let releaseRow!: () => void
    const rowReleased = new Promise<void>((resolve) => (releaseRow = resolve))
    let reportPid!: (pid: number) => void
    const holderPid = new Promise<number>((resolve) => (reportPid = resolve))
    const holding = db.transaction(async (tx) => {
      await tx.select({ id: settings.id }).from(settings).limit(1).for('update')
      const [{ pid }] = getExecuteRows<{ pid: number }>(
        await tx.execute(sql`select pg_backend_pid() as pid`)
      )
      reportPid(pid)
      await rowReleased
    })
    const pid = await holderPid

    let writers: Promise<unknown>[] = []
    try {
      const publish = publishPortalCustomisation(
        { before: { portal: { nav: loadedNav } }, portal: { nav: publishedNav } },
        { permissions: [...ALL_PERMISSIONS], actor: { email: 'owner@example.com', role: 'admin' } }
      )
      writers = [publish]
      await waitForBlockedBy(pid, 1)
      const accessSave = updatePortalConfig({
        access: { visibility: 'private' },
      } as Parameters<typeof updatePortalConfig>[0])
      writers.push(accessSave)
      await waitForBlockedBy(pid, 2)
    } finally {
      releaseRow()
      await holding
    }
    const [published] = await Promise.all(writers)

    expect(published).toMatchObject({ ok: true, parts: ['portal.nav'] })
    const portal = await storedPortal()
    expect(portal.nav).toEqual(publishedNav)
    expect(portal.access).toMatchObject({ visibility: 'private' })
  })
})
