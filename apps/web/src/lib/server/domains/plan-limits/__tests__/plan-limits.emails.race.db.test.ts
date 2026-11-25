/**
 * Real-Postgres proof that two senders of a plan limits email that run at the
 * same moment mail each billing manager once.
 *
 * A send claims its recipients under the settings row lock before any mail
 * leaves. That lock only excludes another sender on another connection: the
 * transactional db test fixture runs every query on one connection inside one
 * transaction, where `select ... for update` never waits on itself, so the
 * race cannot be shown there. Here each sender gets its own pooled connection,
 * and the rows they read are committed into copies of the tables this suite
 * writes, in a schema of its own that is dropped afterwards. Roles and
 * permissions are read from the migrated public tables.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

const race = vi.hoisted(() => ({
  schema: `plan_limits_emails_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
}))

const mail = vi.hoisted(() => ({
  sendPlanLimitsEmail: vi.fn(async (_params: unknown) => ({ sent: true })),
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

// The application cache, kept in memory so its kv rows stay out of the race.
const memoryCache = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    memoryCache.has(key) ? structuredClone(memoryCache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    memoryCache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) memoryCache.delete(key)
  },
}))
vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://app.example.com/',
}))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  isEmailConfigured: () => true,
  sendPlanLimitsEmail: (params: unknown) => mail.sendPlanLimitsEmail(params),
}))

// The db test fixture re-exports its sanctioned direct client import: this suite
// builds its own connections rather than going through the global `db`.
import { createDbFromSql } from '@/lib/server/__tests__/db-test-fixture'
import {
  db,
  eq,
  principal,
  principalRoleAssignments,
  roles,
  settings,
  sql,
  user,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { PlanLimitsView } from '../plan-limits.rules'
import { sendPlanLimitsEmails } from '../plan-limits.emails'

/** The tables this suite writes; everything else resolves to public. */
const OWN_TABLES = ['settings', 'user', 'principal', 'principal_role_assignments']

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${race.schema}`)
  for (const table of OWN_TABLES) {
    await admin.unsafe(
      `create table ${race.schema}."${table}" (like public."${table}" including all)`
    )
  }
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
    if (Date.now() > deadline) throw new Error(`fewer than ${count} senders reached the row`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function addOwner(): Promise<{ id: PrincipalId; email: string }> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${uid}@example.com`
  await db.insert(user).values({ id: uid, name: 'Acme Owner', email })
  await db
    .insert(principal)
    .values({ id, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
  const [owner] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'owner'))
  await db.insert(principalRoleAssignments).values({ principalId: id, roleId: owner!.id } as never)
  return { id, email }
}

const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const graceEndsAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()

/** A grace that began an hour ago: the start email is due. */
const view = {
  enabled: true,
  phase: 'grace',
  plan: 'free',
  since,
  graceEndsAt,
  deadlineDay: null,
  fromPlan: 'business',
  issues: [],
  infoRows: [],
  featureIssues: [],
  features: {},
  fromFeatures: null,
  openBoardIds: null,
  keptBoardId: null,
  seatHolderIds: null,
  visibleStatusComponentIds: null,
  sendingDomainIds: null,
} as unknown as PlanLimitsView

describe.skipIf(!available)('two plan limits email senders racing', () => {
  beforeEach(async () => {
    memoryCache.clear()
    mail.sendPlanLimitsEmail.mockClear()
    for (const table of [...OWN_TABLES].reverse()) {
      await admin!.unsafe(`delete from ${race.schema}."${table}"`)
    }
  })

  it('mails each billing manager once when both reach a fresh record together', async () => {
    await db.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      planLimitsState: { since, graceEndsAt, limitsKey: 'race' } as never,
    })
    const first = await addOwner()
    const second = await addOwner()

    // A third connection holds the row so both senders reach their claim
    // before either commits one.
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

    let senders: Promise<unknown>[] = []
    try {
      senders = [sendPlanLimitsEmails(view), sendPlanLimitsEmails(view)]
      await waitForBlockedBy(pid, 2)
    } finally {
      releaseRow()
      await holding
    }
    const results = await Promise.all(senders)

    expect(results.filter((r) => r === 'start')).toHaveLength(1)
    const mailed = mail.sendPlanLimitsEmail.mock.calls.map((c) => (c[0] as { to: string }).to)
    expect(mailed.sort()).toEqual([first.email, second.email].sort())
    const [row] = await db.select({ state: settings.planLimitsState }).from(settings)
    expect(row?.state).toMatchObject({
      emailsSent: ['start'],
      emailRecipients: {
        start: {
          [first.id]: { status: 'sent' },
          [second.id]: { status: 'sent' },
        },
      },
    })
  })
})
