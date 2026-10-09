/**
 * Real-Postgres proof that two Home requests on separate connections claim the
 * website lookup only once.
 *
 * The racing connections have to see each other's commits, so the rows live in
 * copies of `settings`, `user`, `principal` and `principal_role_assignments`
 * in a schema of this suite's own: no other suite reads what it commits.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

const race = vi.hoisted(() => ({
  schema: `branding_race_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
  fetches: [] as string[],
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
vi.mock('@/lib/server/content/website-branding', () => ({
  fetchWebsiteBranding: async (site: string) => {
    race.fetches.push(site)
    return null
  },
}))
vi.mock('../automatic-website-branding.availability', () => ({
  automaticBrandingAvailable: () => true,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connections rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, principal, settings, sql, user } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { Actor } from '@/lib/server/policy/types'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { ensureAutomaticWebsiteBranding } from '../automatic-website-branding.service'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  for (const table of ['settings', 'user', 'principal', 'principal_role_assignments'])
    await admin.unsafe(
      `create table ${race.schema}."${table}" (like public."${table}" including all)`
    )
  pool = postgres(url, {
    max: 6,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public` },
  })
  race.db = createDbFromSql(pool)
  // The suite deletes and commits rows, so it runs only inside its own schema.
  const [{ schema }] = getExecuteRows<{ schema: string }>(
    await db.execute(sql`select current_schema() as schema`)
  )
  if (schema !== race.schema) throw new Error('the racing pool is not in the suite schema')
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

async function seed(): Promise<[Actor, Actor]> {
  await db.delete(settings)
  await db.delete(principal)
  await db.delete(user)
  await db.insert(settings).values({
    name: 'Acme',
    slug: 'acme-race',
    createdAt: new Date(),
    // Set up just now: automatic branding runs only in the launch window.
    setupState: JSON.stringify({
      version: 2,
      steps: { core: true, workspace: true, startingPoint: null },
      completedAt: new Date().toISOString(),
    }),
    metadata: JSON.stringify({ sibling: 'keep' }),
  })
  const people: Actor[] = []
  for (const name of ['you', 'other']) {
    const userId = createId('user') as UserId
    const principalId = createId('principal') as PrincipalId
    await db.insert(user).values({ id: userId, name: 'Acme', email: `${name}@example.com` })
    await db
      .insert(principal)
      .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
    people.push({
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(ALL_PERMISSIONS),
    })
  }
  return [people[0], people[1]]
}

/** Wait until `count` sessions queue behind the backend `pid`, following the chain. */
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
      throw new Error(`only ${blocked} of ${count} requests reached the row`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Start both requests while a third connection holds the settings row, and
 * release it only once both wait on it. A claim that reads the row without
 * the lock has already decided by the time it queues (on its write), so both
 * would claim; a claim that takes the lock first reads the winner's claim.
 */
async function behindHeldRow<T>(requests: Array<() => Promise<T>>): Promise<T[]> {
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
  const pid = await Promise.race([
    holderPid,
    holding.then(() => Promise.reject(new Error('the row holder ended before holding'))),
  ])
  const racing = Promise.all(requests.map((request) => request()))
  try {
    await waitForBlockedBy(pid, requests.length)
  } finally {
    releaseRow()
    await holding
  }
  return racing
}

describe.skipIf(!available)('automatic website branding claim', () => {
  beforeEach(() => {
    race.fetches.length = 0
  })

  it('fetches once when two Home requests on separate connections overlap', async () => {
    const [you, other] = await seed()
    await behindHeldRow([
      () => ensureAutomaticWebsiteBranding(you),
      () => ensureAutomaticWebsiteBranding(other),
    ])
    expect(race.fetches).toEqual(['example.com'])
    const [row] = await db.select().from(settings)
    const bag = JSON.parse(row.metadata!)
    expect(bag.sibling).toBe('keep')
    expect(bag.brandingLookup.status).toBe('failed')
  })
})
