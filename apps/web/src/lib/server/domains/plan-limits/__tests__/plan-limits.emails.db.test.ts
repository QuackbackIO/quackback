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
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  isEmailConfigured: () => mail.configured,
  sendPlanLimitsEmail: (params: unknown) => mail.sendPlanLimitsEmail(params),
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { detectPlanLimits, getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { setKeptBoard } from '../plan-limits.choosers'
import { readPlanLimitsSources } from '@/lib/server/domains/settings/settings.plan-limits'
import { claimPlanLimitsEmail, deadlineText, sendPlanLimitsEmails } from '../plan-limits.emails'
import { recordSkippedBroadcast, skippedBroadcastCount } from '../plan-limits.broadcasts'
import { planLimitsPage } from '../plan-limits.page'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

let settingsId: WorkspaceId
let billingEmail: string

async function configure(options: { planLimits: boolean; maxBoards?: number | null }) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits: options.planLimits }),
      tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxBoards: options.maxBoards ?? 1 }),
      cloud: null,
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

/** Wait for the send that a first detection starts in the background. */
async function settle() {
  await vi.waitFor(() => expect(mail.sendPlanLimitsEmail).toHaveBeenCalled(), { timeout: 8000 })
}

/** Time for a background send that is expected not to happen. */
async function settleQuietly() {
  await new Promise((resolve) => setTimeout(resolve, 300))
}

describe.skipIf(!fixture.available)('plan limits emails (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
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
    await configure({ planLimits: true })
    const view = await getPlanLimits()
    expect(view.phase).toBe('grace')
    await settle()
    // The detection trigger has sent; an hourly slot after it sends nothing more.
    await Promise.all([sendPlanLimitsEmails(view), sendPlanLimitsEmails(view)])
    expect(sentKinds()).toEqual(['start'])
    const params = mail.sendPlanLimitsEmail.mock.calls[0][0] as {
      to: string
      rows: { label: string; used: number; cap: number }[]
      limitsUrl: string | null
    }
    expect(params.to).toBe(billingEmail)
    expect(params.rows).toEqual([expect.objectContaining({ label: 'Boards', used: 2, cap: 1 })])
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
    await configure({ planLimits: true })
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
    await configure({ planLimits: true })
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
    await configure({ planLimits: true })
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
    // The flag off keeps the state; turning it on again finds it.
    await configure({ planLimits: false })
    await getPlanLimits()
    expect((await storedState())?.emailsSent).toEqual(['start'])
    await configure({ planLimits: true })
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start'])
    expect(view.since).toBe((await storedState())?.since)
  })

  it('does not send the start email when a stale reader merely adopts the stored grace', async () => {
    await configure({ planLimits: true })
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
          limitsKey: '[null,[1,null,null,null,null,null],[]]',
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
    await configure({ planLimits: true })
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

  it('sends nothing with the flag off', async () => {
    await configure({ planLimits: false })
    const view = await getPlanLimits()
    await settleQuietly()
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
    expect(await storedState()).toBeNull()
  })

  it('sends nothing when email is not configured, and sends once it is', async () => {
    await configure({ planLimits: true })
    mail.configured = false
    const view = await getPlanLimits()
    await settleQuietly()
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
    mail.configured = true
    expect(await sendPlanLimitsEmails(view)).toBe('start')
  })

  it('does not send again after a restart', async () => {
    await configure({ planLimits: true })
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
    await configure({ planLimits: true })
    await getPlanLimits()
    await settle()
    expect(sentKinds()).toEqual(['start'])

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 4 * DAY })
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()

    vi.setSystemTime(Date.now() + 1.5 * DAY)
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBe('reminder')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()

    vi.setSystemTime(Date.now() + 2 * DAY)
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBe('enforced')
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(sentKinds()).toEqual(['start', 'reminder', 'enforced'])
  })

  it('skips the reminder and the enforcement email once the workspace is back to ok', async () => {
    await configure({ planLimits: true })
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
    await configure({ planLimits: true })
    await getPlanLimits()
    await settle()
    expect(sentKinds()).toEqual(['start'])

    // A different drop (a lower cap) starts a new grace with its own record.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + DAY })
    await configure({ planLimits: true, maxBoards: 0 })
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
    await configure({ planLimits: true })
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
    await configure({ planLimits: true })
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
    await configure({ planLimits: true })
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

describe.skipIf(!fixture.available)('skipped broadcasts (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    settingsId =
      row?.id ??
      (
        await testDb
          .insert(settings)
          .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
          .returning({ id: settings.id })
      )[0]!.id
  })
  afterEach(async () => {
    await fixture.rollback()
  })

  it('records each broadcast once for the month and counts it on the page row', async () => {
    await configure({ planLimits: true })
    expect(await recordSkippedBroadcast('evt-a')).toBe(true)
    expect(await recordSkippedBroadcast('evt-a')).toBe(false)
    expect(await recordSkippedBroadcast('evt-b')).toBe(true)
    expect(await skippedBroadcastCount()).toBe(2)

    const view = {
      enabled: true,
      phase: 'ok',
      plan: null,
      since: null,
      graceEndsAt: null,
      fromPlan: null,
      issues: [],
      infoRows: [
        {
          key: 'emailsPerMonth',
          used: 5,
          cap: 5,
          message: 'Emails for this month are used up',
        },
      ],
      featureIssues: [],
      features: {},
      fromFeatures: null,
      openBoardIds: null,
      keptBoardId: null,
      seatHolderIds: null,
      visibleStatusComponentIds: null,
      sendingDomainIds: null,
    } as never
    expect(planLimitsPage(view, {}, [], 2).infoRows[0].message).toBe(
      'Emails for this month are used up. 2 updates were not sent'
    )
    expect(planLimitsPage(view, {}, [], 0).infoRows[0].message).toBe(
      'Emails for this month are used up'
    )
  })

  it('records nothing with the flag off', async () => {
    await configure({ planLimits: false })
    expect(await recordSkippedBroadcast('evt-off')).toBeNull()
    expect(await skippedBroadcastCount()).toBe(0)
  })
})
