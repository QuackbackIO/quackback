/**
 * Real-Postgres proof that two simultaneous workspace-step saves end with one
 * admin.
 *
 * The racing saves run on their own connections, so the rows they read have to
 * be committed, and committed rows would leak into every other suite. They go
 * into copies of the app's tables in a schema of this suite's own, which no
 * other suite reads and which is dropped at the end.
 *
 * Both saves are held at the bootstrap lock until both are waiting on it, so
 * each has already passed every check made outside the lock. Whichever the
 * database lets through first, the answer has to be the same.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

const race = vi.hoisted(() => ({
  schema: `claim_race_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: vi.fn(),
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connections rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, principal, settings, user, and, eq } from '@/lib/server/db'
import { saveWorkspaceAndGoalFn } from '../onboarding'

const LOCK_KEY = `hashtextextended('quackback:bootstrap-admin', 0)`

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  const tables = await admin<{ name: string }[]>`
    select table_name as name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`
  for (const { name } of tables) {
    await admin.unsafe(
      `create table ${race.schema}."${name}" (like public."${name}" including all)`
    )
  }
  pool = postgres(url, {
    max: 6,
    onnotice: () => {},
    connection: { search_path: `${race.schema}, public`, application_name: race.schema },
  })
  race.db = createDbFromSql(pool)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

afterAll(async () => {
  await pool?.end()
  await admin?.unsafe(`drop schema if exists ${race.schema} cascade`).catch(() => {})
  await admin?.end()
})

async function seedUser(email: string): Promise<UserId> {
  const id = createId('user') as UserId
  await db.insert(user).values({
    id,
    name: email.split('@')[0],
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function seedPrincipal(userId: UserId, createdAt: Date): Promise<void> {
  await db.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'user',
    type: 'user',
    createdAt,
  })
}

async function admins(): Promise<Array<string | null>> {
  const rows = await db
    .select({ userId: principal.userId })
    .from(principal)
    .where(and(eq(principal.role, 'admin'), eq(principal.type, 'user')))
  return rows.map((row) => row.userId)
}

/** Wait until `count` of this suite's connections are queued on the lock. */
async function waitForWaiters(count: number): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const [row] = await admin!<{ waiting: number }[]>`
      select count(*)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
       where l.locktype = 'advisory' and not l.granted and a.application_name = ${race.schema}`
    if (row!.waiting >= count) return
    if (Date.now() > deadline)
      throw new Error(`only ${row!.waiting} of ${count} saves reached the lock`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Run both saves together, released only once both wait on the lock. */
async function raceSaves(...callers: Array<{ userId: UserId; workspaceName: string }>) {
  for (const { userId } of callers) {
    hoisted.getSession.mockResolvedValueOnce({
      session: { scope: 'dashboard' },
      user: { id: userId },
    })
  }
  await admin!.unsafe(`select pg_advisory_lock(${LOCK_KEY})`)
  const saves = callers.map(({ workspaceName }) =>
    saveWorkspaceAndGoalFn({ data: { workspaceName } })
  )
  try {
    await waitForWaiters(callers.length)
  } finally {
    await admin!.unsafe(`select pg_advisory_unlock(${LOCK_KEY})`)
  }
  return Promise.all(saves)
}

describe.skipIf(!available)('two workspace-step saves at once', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    for (const table of ['principal', 'user', 'settings', 'post_statuses', 'kv_store']) {
      await admin!.unsafe(`delete from ${race.schema}."${table}"`).catch(() => {})
    }
  })

  // Two accounts on an install still being set up, both submitting the
  // workspace step. The first account created owns setup, whichever save the
  // database serves first.
  it('promotes only the account that claimed setup', async () => {
    const ownerId = await seedUser('owner@acme.example')
    await seedPrincipal(ownerId, new Date('2026-10-01T09:00:00Z'))
    const secondId = await seedUser('second@elsewhere.example')
    await seedPrincipal(secondId, new Date('2026-10-01T09:00:01Z'))

    const results = await raceSaves(
      { userId: secondId, workspaceName: 'Hijacked' },
      { userId: ownerId, workspaceName: 'Fernhill' }
    )

    expect(await admins()).toEqual([ownerId])
    expect(results).toEqual([
      { ok: false, refusal: 'not_owner' },
      expect.objectContaining({ ok: true, name: 'Fernhill' }),
    ])
    expect(await db.select({ name: settings.name }).from(settings)).toEqual([{ name: 'Fernhill' }])
  })

  // Neither caller has a principal yet, so there is no claimant to decide by:
  // the lock alone has to leave exactly one of them admin.
  it('leaves exactly one admin when neither caller has a principal yet', async () => {
    const aId = await seedUser('a@acme.example')
    const bId = await seedUser('b@acme.example')

    const results = await raceSaves(
      { userId: aId, workspaceName: 'A Co' },
      { userId: bId, workspaceName: 'B Co' }
    )

    const promoted = await admins()
    expect(promoted).toHaveLength(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, refusal: 'not_owner' }])
    expect(await db.select({ id: settings.id }).from(settings)).toHaveLength(1)
  })
})
