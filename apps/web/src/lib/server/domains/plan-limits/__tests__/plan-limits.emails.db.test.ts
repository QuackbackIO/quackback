/**
 * The plan limits emails against a real database: each goes out once per
 * grace to billing managers only, survives a restart, and repeats for a new
 * grace.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  inArray,
  invitation,
  isNull,
  principal,
  principalRoleAssignments,
  roles,
  settings,
  user,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const lookups = vi.hoisted(() => ({ resolve: vi.fn(), managers: vi.fn() }))
const mail = vi.hoisted(() => ({
  configured: true,
  sendPlanLimitsEmail: vi.fn(async (_params: unknown) => ({ sent: true })),
}))

// The application cache, kept in memory: its kv rows are shared by every test
// file on the database, and a write that collides with another file's commit
// aborts this test's transaction.
const memoryCache = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    memoryCache.has(key) ? structuredClone(memoryCache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    memoryCache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) memoryCache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', async (original) => ({
  ...(await original<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://app.example.com/',
}))
// While `race.lose` is set, another process stores the same drop's grace
// first, so this process's compare-and-set finds a changed row and loses.
const race = vi.hoisted(() => ({ lose: false, rivalSince: null as string | null }))
vi.mock('@/lib/server/domains/settings/settings.plan-limits', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/settings/settings.plan-limits')>()
  return {
    ...real,
    compareAndSetPlanLimitsState: async (
      expected: unknown,
      next: Parameters<typeof real.compareAndSetPlanLimitsState>[1]
    ) => {
      if (!race.lose || !next) return real.compareAndSetPlanLimitsState(expected, next)
      const rival = { ...next, since: race.rivalSince ?? next.since }
      expect(await real.compareAndSetPlanLimitsState(expected, rival)).toBe(true)
      return real.compareAndSetPlanLimitsState(expected, next)
    },
  }
})
vi.mock('@/lib/server/email/recipient', async (original) => {
  const real = await original<typeof import('@/lib/server/email/recipient')>()
  lookups.resolve.mockImplementation(real.resolveAccountRecipient)
  return {
    ...real,
    resolveAccountRecipient: (...args: Parameters<typeof real.resolveAccountRecipient>) =>
      lookups.resolve(...args),
  }
})
vi.mock('@/lib/server/domains/channel-accounts/sending-domain-notify', async (original) => {
  const real =
    await original<typeof import('@/lib/server/domains/channel-accounts/sending-domain-notify')>()
  lookups.managers.mockImplementation(real.managersHolding)
  return {
    ...real,
    managersHolding: (...args: Parameters<typeof real.managersHolding>) =>
      lookups.managers(...args),
  }
})
// The month's usage report, as hosted billing receives it.
const reported = vi.hoisted(() => ({ months: [] as string[] }))
vi.mock('@/lib/server/control-plane/client', async (original) => ({
  ...(await original<typeof import('@/lib/server/control-plane/client')>()),
  reportWorkspaceUsage: async (report: { month: string }) => {
    reported.months.push(report.month)
  },
}))
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  isEmailConfigured: () => mail.configured,
  sendPlanLimitsEmail: (params: unknown) => mail.sendPlanLimitsEmail(params),
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import {
  detectPlanLimits,
  getPlanLimits,
  invalidatePlanLimits,
  isFeatureLive,
} from '../plan-limits.service'
import { setKeptBoard } from '../plan-limits.choosers'
import { readPlanLimitsSources } from '@/lib/server/domains/settings/settings.plan-limits'
import { claimPlanLimitsEmail, deadlineText, sendPlanLimitsEmails } from '../plan-limits.emails'
import { planBillingOn } from './plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

let settingsId: WorkspaceId
let billingEmail: string

/** `planBilling` off is an install without plan billing. */
async function configure(options: {
  planBilling: boolean
  maxBoards?: number | null
  keepTierLimits?: boolean
}) {
  await testDb
    .update(settings)
    .set({
      ...(options.keepTierLimits
        ? {}
        : {
            tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxBoards: options.maxBoards ?? 1 }),
          }),
      cloud: (options.planBilling ? planBillingOn() : null) as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

async function addPerson(
  role: 'owner' | 'admin' | null,
  principalRole: 'admin' | 'member' | 'user'
): Promise<string> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${uid}@example.com`
  await testDb.insert(user).values({ id: uid, name: 'Acme Person', email })
  await testDb
    .insert(principal)
    .values({ id, userId: uid, role: principalRole, type: 'user', createdAt: new Date() })
  if (role) {
    const [row] = await testDb.select().from(roles).where(eq(roles.key, role)).limit(1)
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: id, roleId: row!.id } as never)
  }
  return email
}

async function storedState(): Promise<Record<string, unknown> | null> {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  return (row?.state as Record<string, unknown> | null) ?? null
}

function sentKinds(): string[] {
  return mail.sendPlanLimitsEmail.mock.calls.map((c) => (c[0] as { kind: string }).kind)
}

/**
 * Wait for the send that a first detection starts in the background to finish:
 * its mail is out and its outcome is stored, so it cannot land on a later step.
 */
async function settle() {
  await vi.waitFor(
    async () => {
      expect(mail.sendPlanLimitsEmail).toHaveBeenCalled()
      expect((await storedState())?.emailsSent).toContain('start')
    },
    { timeout: 8000 }
  )
}

/** Time for a background send that is expected not to happen. */
async function settleQuietly() {
  await new Promise((resolve) => setTimeout(resolve, 300))
}

describe.skipIf(!fixture.available)('plan limits emails (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    memoryCache.clear()
    vi.useRealTimers()
    mail.configured = true
    mail.sendPlanLimitsEmail.mockClear()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    settingsId =
      row?.id ??
      (
        await testDb
          .insert(settings)
          .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
          .returning({ id: settings.id })
      )[0]!.id
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb
      .update(principal)
      .set({ role: 'user' })
      .where(inArray(principal.role, ['admin', 'member']))
    await testDb
      .update(invitation)
      .set({ status: 'canceled' })
      .where(eq(invitation.status, 'pending'))
    billingEmail = await addPerson('owner', 'admin')
    await addPerson('admin', 'admin')
    await addPerson(null, 'user')
    for (const name of ['Acme one', 'Acme two']) {
      await testDb.insert(boards).values({ name, slug: `${name}-${createId('board')}` })
    }
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('sends the start email once, to billing managers only', async () => {
    await configure({ planBilling: true })
    const view = await getPlanLimits()
    expect(view.phase).toBe('grace')
    await settle()
    // The detection trigger has sent; an hourly slot after it sends nothing more.
    await Promise.all([sendPlanLimitsEmails(view), sendPlanLimitsEmails(view)])
    expect(sentKinds()).toEqual(['start'])
    const params = mail.sendPlanLimitsEmail.mock.calls[0][0] as {
      to: string
      rows: { key: string; used: number; cap: number }[]
      limitsUrl: string | null
      deadline: string
    }
    expect(params.to).toBe(billingEmail)
    // The last full day to fix, not the day the grace ends.
    expect(params.deadline).toBe(
      deadlineText(new Date(`${view.deadlineDay}T12:00:00.000Z`), new Date()).deadline
    )
    expect(params.deadline).not.toBe(deadlineText(new Date(view.graceEndsAt!), new Date()).deadline)
    // Other test files commit boards of their own, so the count is at least ours.
    expect(params.rows).toEqual([expect.objectContaining({ key: 'maxBoards', cap: 1 })])
    expect(params.rows[0]!.used).toBeGreaterThanOrEqual(2)
    expect(params.limitsUrl).toBe('https://app.example.com/admin/settings/billing/limits')
    expect((await storedState())?.emailsSent).toEqual(['start'])
  })

  it('formats the deadline inline and for headings, with the year only when it differs', () => {
    const at = new Date('2026-11-23T10:00:00.000Z')
    expect(deadlineText(at, new Date('2026-11-18T00:00:00.000Z'))).toEqual({
      deadline: 'Nov 23',
      deadlineHeading: 'Mon, Nov 23',
    })
    expect(deadlineText(at, new Date('2027-01-02T00:00:00.000Z')).deadline).toBe('Nov 23, 2026')
  })

  it('lets one caller claim each recipient per grace and refuses a stale grace', async () => {
    await configure({ planBilling: true })
    const view = await getPlanLimits()
    await settle()
    const since = view.since!
    const [p1] = await testDb
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.role, 'admin'))
    const id = p1!.id as string
    // The background send already took 'start' for everyone.
    expect(await claimPlanLimitsEmail('start', since, [id])).toEqual([])
    expect(await claimPlanLimitsEmail('reminder', since, [id])).toEqual([id])
    // A live claim is not taken twice; a stale grace claims nothing.
    expect(await claimPlanLimitsEmail('reminder', since, [id])).toEqual([])
    expect(await claimPlanLimitsEmail('enforced', '2020-01-01T00:00:00.000Z', [id])).toEqual([])
    expect((await storedState())?.emailsSent).toEqual(['start'])
  })

  it('takes a claim again once its lease has lapsed, as after a crash mid-send', async () => {
    await configure({ planBilling: true })
    const view = await getPlanLimits()
    await settle()
    const since = view.since!
    const now = new Date()
    expect(await claimPlanLimitsEmail('reminder', since, ['p1'], now)).toEqual(['p1'])
    expect(await claimPlanLimitsEmail('reminder', since, ['p1'], new Date(+now + 60_000))).toEqual(
      []
    )
    expect(
      await claimPlanLimitsEmail('reminder', since, ['p1'], new Date(+now + 16 * 60_000))
    ).toEqual(['p1'])
  })

  it('keeps the record through the foundation write paths', async () => {
    await configure({ planBilling: true })
    const view = await getPlanLimits()
    await settle()
    const [board] = await testDb
      .select({ id: boards.id })
      .from(boards)
      .where(isNull(boards.deletedAt))
    expect(await setKeptBoard(board!.id)).toEqual({ ok: true })
    expect((await storedState())?.emailsSent).toEqual(['start'])
    await detectPlanLimits()
    expect((await storedState())?.emailsSent).toEqual(['start'])
    // Plan billing off keeps the state; turning it on again finds it.
    await configure({ planBilling: false })
    await getPlanLimits()
    expect((await storedState())?.emailsSent).toEqual(['start'])
    await configure({ planBilling: true })
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start'])
    expect(view.since).toBe((await storedState())?.since)
  })

  it('sends the start email outside the evaluation that started the grace', async () => {
    await configure({ planBilling: true })
    // Single sign-on is off on this plan: a real read says so, while a helper
    // asked from inside an evaluation answers as on a read error (live).
    await testDb
      .update(settings)
      .set({
        tierLimits: JSON.stringify({
          ...OSS_TIER_LIMITS,
          maxBoards: 1,
          features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
        }),
      })
      .where(eq(settings.id, settingsId))
    await configure({ planBilling: true, keepTierLimits: true })
    const seen: boolean[] = []
    mail.sendPlanLimitsEmail.mockImplementationOnce(async () => {
      seen.push(await isFeatureLive('sso'))
      return { sent: true }
    })
    expect((await getPlanLimits()).phase).toBe('grace')
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 8000 })
    expect(seen).toEqual([false])
  })

  it("starts a parked workspace's grace from the month's usage report the catch-up queues", async () => {
    await configure({ planBilling: true })
    const control = process.env.QUACKBACK_CONTROL_PLANE_URL
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    reported.months = []
    // Nobody has visited: no request has detected anything.
    expect(await storedState()).toBeNull()
    const catchUpAt = new Date(Date.now() + 3 * DAY)
    vi.useFakeTimers({ toFake: ['Date'], now: catchUpAt })
    try {
      const { runUsageReport } = await import('@/lib/server/domains/billing/usage-report-queue')
      const { usageReportDedupeKey } = await import('@/lib/server/domains/billing/usage-report')
      await runUsageReport({
        id: '1',
        jobId: 'job_1',
        queue: 'usage-report',
        dedupeKey: usageReportDedupeKey('2026-10'),
        payload: { month: '2026-10' },
        workspaceKey: null,
        attempts: 1,
        maxAttempts: 10,
        leaseToken: 'tok',
        lockedUntil: new Date(),
        runAt: new Date(),
      })
      expect(reported.months).toEqual(['2026-10'])
      // Read from the row, not through plan limits, which would detect too.
      expect((await storedState())?.since).toBe(catchUpAt.toISOString())
      await settle()
      expect(sentKinds()).toEqual(['start'])
    } finally {
      if (control === undefined) delete process.env.QUACKBACK_CONTROL_PLANE_URL
      else process.env.QUACKBACK_CONTROL_PLANE_URL = control
    }
  })

  it('does not send the start email when a stale reader merely adopts the stored grace', async () => {
    await configure({ planBilling: true })
    // The key of the limits a grace is granted against, from a first detection.
    await getPlanLimits()
    await settle()
    const limitsKey = (await storedState())?.limitsKey
    await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
    await configure({ planBilling: true })
    mail.sendPlanLimitsEmail.mockClear()
    // Warm the settings cache while no grace is stored.
    await readPlanLimitsSources()
    const since = new Date().toISOString()
    await testDb
      .update(settings)
      .set({
        planLimitsState: {
          since,
          graceEndsAt: new Date(Date.now() + 7 * DAY).toISOString(),
          fromPlan: null,
          fromFeatures: {},
          limitsKey: limitsKey,
        } as never,
      })
      .where(eq(settings.id, settingsId))
    // The reader's copy still says there is none; its write loses to the stored one.
    const view = await getPlanLimits()
    await settleQuietly()
    expect(view.since).toBe(since)
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
  })

  it('does not send the start email from a process that loses the race to store the grace', async () => {
    await configure({ planBilling: true })
    race.lose = true
    race.rivalSince = new Date(Date.now() - 1000).toISOString()
    try {
      const view = await getPlanLimits()
      await settleQuietly()
      // The rival's grace stands and its own detection sends the start email.
      expect(view.phase).toBe('grace')
      expect(view.since).toBe(race.rivalSince)
      expect((await storedState())?.since).toBe(race.rivalSince)
      expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
      expect((await storedState())?.emailsSent ?? []).toEqual([])
    } finally {
      race.lose = false
      race.rivalSince = null
    }
  })

  it('sends nothing without plan billing', async () => {
    await configure({ planBilling: false })
    const view = await getPlanLimits()
    await settleQuietly()
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
    expect(await storedState()).toBeNull()
  })

  it('sends nothing when email is not configured, and sends once it is', async () => {
    await configure({ planBilling: true })
    mail.configured = false
    const view = await getPlanLimits()
    await settleQuietly()
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
    mail.configured = true
    expect(await sendPlanLimitsEmails(view)).toBe('start')
  })

  it('does not send again after a restart', async () => {
    await configure({ planBilling: true })
    await getPlanLimits()
    await settle()
    expect(sentKinds()).toEqual(['start'])
    // A fresh process: every cache is cold, only the database remains.
    await invalidateSettingsCache()
    await invalidatePlanLimits()
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start'])
  })

  it('sends the reminder two days before the end, once, and the enforcement email after it', async () => {
    await configure({ planBilling: true })
    // The grace ends at the first noon UTC after seven days, so time is set
    // from its end rather than from now.
    const end = Date.parse((await getPlanLimits()).graceEndsAt!)
    await settle()
    expect(sentKinds()).toEqual(['start'])

    vi.useFakeTimers({ toFake: ['Date'], now: end - 3 * DAY })
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()

    vi.setSystemTime(end - 1.5 * DAY)
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBe('reminder')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()

    vi.setSystemTime(end + DAY / 2)
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBe('enforced')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start', 'reminder', 'enforced'])
  })

  it('skips the reminder and the enforcement email once the workspace is back to ok', async () => {
    await configure({ planBilling: true })
    await getPlanLimits()
    await settle()
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb.insert(boards).values({ name: 'Acme only', slug: `only-${createId('board')}` })
    await invalidatePlanLimits()

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * DAY })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    vi.setSystemTime(Date.now() + 3 * DAY)
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start'])
  })

  it('sends again for a new grace', async () => {
    await configure({ planBilling: true })
    await getPlanLimits()
    await settle()
    expect(sentKinds()).toEqual(['start'])

    // A different drop (a lower cap) starts a new grace with its own record.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY })
    await configure({ planBilling: true, maxBoards: 0 })
    const second = await getPlanLimits()
    expect(second.phase).toBe('grace')
    // The new grace's own trigger sends its start email; nothing more follows.
    await vi.waitFor(() => expect(sentKinds()).toEqual(['start', 'start']), { timeout: 8000 })
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start', 'start'])
  })

  async function resetRecord() {
    const { emailsSent: _a, emailRecipients: _b, ...rest } = (await storedState()) ?? {}
    await testDb
      .update(settings)
      .set({ planLimitsState: rest as never })
      .where(eq(settings.id, settingsId))
    await invalidateSettingsCache()
    mail.sendPlanLimitsEmail.mockClear()
  }

  const recipientOf = (call: unknown[]) => (call[0] as { to: string }).to

  it('retries only the recipients that failed, and sends nothing once all have it', async () => {
    const second = await addPerson('owner', 'admin')
    await configure({ planBilling: true })
    const view = await getPlanLimits()
    await settle()
    await resetRecord()
    mail.sendPlanLimitsEmail.mockImplementation(async (params: unknown) => {
      if ((params as { to: string }).to === second) throw new Error('provider down')
      return { sent: true }
    })

    expect(await sendPlanLimitsEmails(view)).toBe('start')
    expect(mail.sendPlanLimitsEmail.mock.calls.map(recipientOf).sort()).toEqual(
      [billingEmail, second].sort()
    )
    expect((await storedState())?.emailsSent ?? []).toEqual([])

    mail.sendPlanLimitsEmail.mockClear()
    mail.sendPlanLimitsEmail.mockImplementation(async () => ({ sent: true }))
    expect(await sendPlanLimitsEmails(view)).toBe('start')
    expect(mail.sendPlanLimitsEmail.mock.calls.map(recipientOf)).toEqual([second])
    expect((await storedState())?.emailsSent).toEqual(['start'])

    mail.sendPlanLimitsEmail.mockClear()
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
  })

  it('retries everyone when every send fails', async () => {
    await configure({ planBilling: true })
    const view = await getPlanLimits()
    await settle()
    await resetRecord()
    mail.sendPlanLimitsEmail.mockRejectedValueOnce(new Error('provider down'))
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    expect((await storedState())?.emailsSent ?? []).toEqual([])
    expect(await sendPlanLimitsEmails(view)).toBe('start')
    expect(mail.sendPlanLimitsEmail).toHaveBeenCalledTimes(2)
  })

  it('makes no recipient lookups once the email is complete', async () => {
    await configure({ planBilling: true })
    await getPlanLimits()
    await settle()
    lookups.resolve.mockClear()
    lookups.managers.mockClear()
    const view = await getPlanLimits()
    expect(view.emailsSent).toEqual(['start'])
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    expect(lookups.resolve).not.toHaveBeenCalled()
    expect(lookups.managers).not.toHaveBeenCalled()
  })
})
