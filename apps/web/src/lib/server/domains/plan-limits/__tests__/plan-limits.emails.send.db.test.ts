/**
 * What the plan limits emails carry and who gets them, against a real
 * database: a plan drop from a billing projection names the workspace, both
 * plans and the links; billing rights decide the recipients, however they are
 * held; concurrent senders mail each person once; a workspace that fits or has
 * no tier limits sends nothing; and the emails never count on the email meter.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  emailLog,
  eq,
  inArray,
  invitation,
  isNull,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  settings,
  user,
  webhooks,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const mail = vi.hoisted(() => ({
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
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  isEmailConfigured: () => true,
  sendPlanLimitsEmail: (params: unknown) => mail.sendPlanLimitsEmail(params),
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { parseBillingProjection } from '@/lib/server/domains/settings/cloud/billing-projection'
import { writeBillingProjection } from '@/lib/server/domains/settings/cloud/billing-projection.write'
import { emailsSentInUtcMonth } from '@/lib/server/email/email-budget'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { claimPlanLimitsEmail, deadlineText, sendPlanLimitsEmails } from '../plan-limits.emails'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

let settingsId: WorkspaceId
let workspaceName: string

type Sent = {
  kind: string
  to: string
  workspaceName?: string
  planName: string | null
  fromPlanName: string | null
  deadline: string
  deadlineHeading: string
  rows: { label: string; used: number; cap: number }[]
  pausingFeatures: string[]
  limitsUrl: string | null
  planUrl: string | null
}
const sends = () => mail.sendPlanLimitsEmail.mock.calls.map((c) => c[0] as Sent)
/**
 * Who among `people` was mailed, in order. Other test files on the database
 * commit people of their own, so recipients are read against the ones a test
 * made.
 */
const mailedOf = (...people: { email: string }[]) =>
  sends()
    .map((s) => s.to)
    .filter((to) => people.some((p) => p.email === to))

async function configure(tierLimits: unknown, cloud: unknown = null) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits: true }),
      tierLimits: tierLimits === null ? null : JSON.stringify(tierLimits),
      cloud: cloud as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

async function addPerson(options: {
  roleKey?: string
  roleId?: string
  email?: string
  principalRole?: 'admin' | 'member' | 'user'
}): Promise<{ email: string; id: PrincipalId }> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = options.email ?? `${uid}@example.com`
  await testDb.insert(user).values({ id: uid, name: 'Acme Person', email })
  await testDb.insert(principal).values({
    id,
    userId: uid,
    role: options.principalRole ?? 'admin',
    type: 'user',
    createdAt: new Date(),
  })
  const roleId =
    options.roleId ??
    (options.roleKey
      ? (await testDb.select().from(roles).where(eq(roles.key, options.roleKey)).limit(1))[0]!.id
      : null)
  if (roleId) {
    await testDb.insert(principalRoleAssignments).values({ principalId: id, roleId } as never)
  }
  return { email, id }
}

/** A custom role that holds only the right to manage billing. */
async function billingOnlyRole(): Promise<string> {
  const [role] = await testDb
    .insert(roles)
    .values({ key: `billing-${createId('user')}`, name: 'Acme billing' })
    .returning({ id: roles.id })
  const [perm] = await testDb
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'billing.manage'))
  await testDb.insert(rolePermissions).values({ roleId: role!.id, permissionId: perm!.id } as never)
  return role!.id
}

async function storedEmailsSent(): Promise<unknown> {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  return (row?.state as { emailsSent?: unknown } | null)?.emailsSent
}

/**
 * Wait for the start email a first detection sends in the background to reach
 * at least `count` recipients and its outcome to be stored, so it cannot land
 * on a later step.
 */
async function settle(count = 1) {
  await vi.waitFor(
    async () => {
      expect(mail.sendPlanLimitsEmail.mock.calls.length).toBeGreaterThanOrEqual(count)
      expect(await storedEmailsSent()).toContain('start')
    },
    { timeout: 8000 }
  )
}

async function resetRecord() {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  const {
    emailsSent: _a,
    emailRecipients: _b,
    ...rest
  } = (row?.state ?? {}) as Record<string, unknown>
  await testDb
    .update(settings)
    .set({ planLimitsState: rest as never })
    .where(eq(settings.id, settingsId))
  await invalidateSettingsCache()
  mail.sendPlanLimitsEmail.mockClear()
}

describe.skipIf(!fixture.available)('plan limits emails: content and recipients (real DB)', () => {
  const instance = process.env.QUACKBACK_INSTANCE_ID
  let owner: { email: string; id: PrincipalId }

  beforeEach(async () => {
    await fixture.begin()
    memoryCache.clear()
    vi.useRealTimers()
    process.env.QUACKBACK_INSTANCE_ID = 'ws_acme'
    mail.sendPlanLimitsEmail.mockReset()
    mail.sendPlanLimitsEmail.mockImplementation(async () => ({ sent: true }))
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    workspaceName = `Acme ${createId('user').slice(-6)}`
    settingsId =
      row?.id ??
      (
        await testDb
          .insert(settings)
          .values({ name: workspaceName, slug: `acme-${createId('user')}`, createdAt: new Date() })
          .returning({ id: settings.id })
      )[0]!.id
    await testDb
      .update(settings)
      .set({ name: workspaceName, planLimitsState: null })
      .where(eq(settings.id, settingsId))
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb
      .update(principal)
      .set({ role: 'user' })
      .where(inArray(principal.role, ['admin', 'member']))
    await testDb
      .update(invitation)
      .set({ status: 'canceled' })
      .where(eq(invitation.status, 'pending'))
    owner = await addPerson({ roleKey: 'owner' })
    for (const name of ['Acme one', 'Acme two']) {
      await testDb.insert(boards).values({ name, slug: `${name}-${createId('board')}` })
    }
  })
  afterEach(async () => {
    vi.useRealTimers()
    if (instance === undefined) delete process.env.QUACKBACK_INSTANCE_ID
    else process.env.QUACKBACK_INSTANCE_ID = instance
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('names the workspace, both plans and the links after a drop from Business to Free', async () => {
    // A webhook Business includes and Free does not, running when the plan drops.
    await testDb.insert(webhooks).values({
      url: 'https://example.com/hook',
      secret: 'acme-secret',
      events: ['post.created'],
      createdById: owner.id,
    } as never)
    await configure(null, { enabled: true, projection: projection(1, 'business', null) })
    expect((await getPlanLimits()).phase).toBe('ok')
    await writeBillingProjection('ws_acme', parseBillingProjection(projection(2, 'free', 1))!)
    const view = await getPlanLimits()
    expect(view.phase).toBe('grace')
    await settle()
    const [sent] = sends()
    expect(sent).toMatchObject({
      kind: 'start',
      to: owner.email,
      workspaceName,
      planName: 'Free',
      fromPlanName: 'Business',
      limitsUrl: 'https://app.example.com/admin/settings/billing/limits',
      planUrl: 'https://app.example.com/admin/settings/billing',
      // Other test files commit rows of their own, so counts are at least ours.
      rows: [expect.objectContaining({ label: 'Boards', used: expect.any(Number), cap: 1 })],
      pausingFeatures: expect.arrayContaining(['Webhooks']),
      ...deadlineText(new Date(`${view.deadlineDay}T12:00:00.000Z`), new Date()),
    })
  })

  it('sends to everyone who holds billing rights, through any role, and skips the rest', async () => {
    const custom = await addPerson({ roleId: await billingOnlyRole(), principalRole: 'member' })
    const admin = await addPerson({ roleKey: 'admin' })
    const member = await addPerson({ principalRole: 'member' })
    // A billing manager with no deliverable address is skipped, not failed.
    const anon = await addPerson({
      roleKey: 'owner',
      email: `temp-${createId('user')}@anon.quackback.io`,
    })
    await configure({ ...OSS_TIER_LIMITS, maxBoards: 1 })
    await getPlanLimits()
    await settle(2)
    expect(mailedOf(owner, custom, admin, member, anon).sort()).toEqual(
      [owner.email, custom.email].sort()
    )
  })

  it('mails each recipient once when two senders race on a fresh record', async () => {
    const second = await addPerson({ roleKey: 'owner' })
    await configure({ ...OSS_TIER_LIMITS, maxBoards: 1 })
    const view = await getPlanLimits()
    await settle(2)
    await resetRecord()
    const results = await Promise.all([sendPlanLimitsEmails(view), sendPlanLimitsEmails(view)])
    expect(results.filter((r) => r === 'start').length).toBeGreaterThanOrEqual(1)
    expect(mailedOf(owner, second).sort()).toEqual([owner.email, second.email].sort())
  })

  it('leaves a recipient another sender holds to that sender', async () => {
    const second = await addPerson({ roleKey: 'owner' })
    await configure({ ...OSS_TIER_LIMITS, maxBoards: 1 })
    const view = await getPlanLimits()
    await settle(2)
    await resetRecord()
    // Another process is mid-send to the owner.
    expect(await claimPlanLimitsEmail('start', view.since!, [owner.id])).toEqual([owner.id])
    expect(await sendPlanLimitsEmails(view)).toBe('start')
    expect(mailedOf(owner, second)).toEqual([second.email])
  })

  it('does not reopen a complete email for someone who gains billing rights later', async () => {
    await configure({ ...OSS_TIER_LIMITS, maxBoards: 1 })
    const view = await getPlanLimits()
    await settle()
    const late = await addPerson({ roleKey: 'owner' })
    expect(await claimPlanLimitsEmail('start', view.since!, [owner.id, late.id])).toEqual([])
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(mailedOf(owner, late)).toEqual([owner.email])
  })

  it('sends nothing with no tier limits, as on an install without plan billing', async () => {
    await configure(OSS_TIER_LIMITS)
    const view = await getPlanLimits()
    expect(view.phase).toBe('ok')
    expect(await sendPlanLimitsEmails(view)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(mail.sendPlanLimitsEmail).not.toHaveBeenCalled()
  })

  it('sends a fresh start email for a new drop after an upgrade put things right', async () => {
    await configure(null, { enabled: true, projection: projection(1, 'business', null) })
    await writeBillingProjection('ws_acme', parseBillingProjection(projection(2, 'free', 1))!)
    const first = await getPlanLimits()
    await settle()
    // An upgrade during the grace: back to ok at once.
    await writeBillingProjection(
      'ws_acme',
      parseBillingProjection(projection(3, 'business', null))!
    )
    expect((await getPlanLimits()).phase).toBe('ok')
    // A later drop is a new grace with its own email.
    await writeBillingProjection('ws_acme', parseBillingProjection(projection(4, 'free', 1))!)
    const second = await getPlanLimits()
    expect(second.phase).toBe('grace')
    expect(second.since).not.toBe(first.since)
    await settle(2)
    expect(mailedOf(owner)).toEqual([owner.email, owner.email])
    expect(new Set(sends().map((s) => s.kind))).toEqual(new Set(['start']))
    expect(await sendPlanLimitsEmails(await getPlanLimits())).toBeNull()
    expect(mailedOf(owner)).toHaveLength(2)
  })
})

describe.skipIf(!fixture.available)('plan limits emails and the email meter (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    memoryCache.clear()
  })
  afterEach(fixture.rollback)

  it('never counts a plan limits email, while a broadcast counts', async () => {
    // A month long past, so no other test file's mail lands in it.
    const month = new Date('2001-03-15T00:00:00.000Z')
    const row = {
      direction: 'outbound',
      status: 'sent',
      provider: 'resend',
      address: 'a@example.com',
      createdAt: month,
    }
    expect(await emailsSentInUtcMonth(month)).toBe(0)
    await testDb
      .insert(emailLog)
      .values({ ...row, emailType: 'PlanLimitsEmail', subject: 'Action needed' } as never)
    expect(await emailsSentInUtcMonth(month)).toBe(0)
    await testDb
      .insert(emailLog)
      .values({ ...row, emailType: 'ChangelogPublishedEmail', subject: 'May' } as never)
    expect(await emailsSentInUtcMonth(month)).toBe(1)
  })
})

function projection(version: number, plan: string, maxBoards: number | null) {
  // Business has every paid feature a workspace (or another test file) may have set up.
  const paid = [
    'aiAssistant',
    'aiArticleTranslation',
    'customDomain',
    'sso',
    'webhooks',
    'workflows',
  ]
  const entitlements = plan === 'free' ? {} : Object.fromEntries(paid.map((key) => [key, true]))
  const limits = (boards: number | null) => ({
    maxBoards: boards,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: null,
    maxCustomRoles: null,
    maxSendingDomains: null,
    aiTokensPerMonth: null,
    emailsPerMonth: null,
    apiRequestsPerMonth: null,
    apiRequestsPerMinute: null,
    maxInboundEmailAddresses: null,
    maxHelpCenterLocales: null,
    maxStatusSubscribers: null,
  })
  return {
    version,
    effectivePlan: plan,
    trialStartedAt: null,
    trialExpiresAt: null,
    subscriptionStatus: plan === 'free' ? null : 'active',
    entitlements,
    freeLimits: limits(1),
    planLimits: limits(maxBoards),
    planLimitsExpireAt: null,
    canUpgrade: true,
    canManageBilling: true,
    renewalAt: null,
    cancellationAt: null,
  }
}
