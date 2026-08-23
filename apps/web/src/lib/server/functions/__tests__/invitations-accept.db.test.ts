/**
 * Accept-time seat backstop against live roster rows.
 *
 * The mock suite proves the handler calls enforceSeatLimit. This one drives
 * acceptInvitationFn through real principals, a pending team invite, and a
 * projected maxTeamSeats, so a refused accept leaves the invite pending.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, invitation, principal, settings, user } from '@/lib/server/db'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
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

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))
vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: () => null }))
vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  revokeMagicLinkTokens: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))
vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: async () => ({ enabled: true, plan: 'pro', trialActive: false }),
}))

const { acceptInvitationFn } = await import('../invitations')
const { countSeatUsage } = await import('@/lib/server/domains/principals/seat-usage')
const { invalidateTierLimitsCache } =
  await import('@/lib/server/domains/settings/tier-limits.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, email: user.email }).from(user).limit(0)
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: invitation.id, kind: invitation.kind }).from(invitation).limit(0)
    await db.select({ id: settings.id, cloud: settings.cloud }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(email: string): Promise<UserId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'Teammate', email })
  return userId
}

async function seedMember(email: string): Promise<UserId> {
  const userId = await seedUser(email)
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'member',
    type: 'user',
    createdAt: new Date(),
  })
  return userId
}

async function projectMaxTeamSeats(maxTeamSeats: number): Promise<void> {
  const cloud = storedCloud('pro')
  const projection = {
    ...cloud,
    projection: {
      ...cloud.projection,
      subscriptionStatus: 'active' as const,
      canManageBilling: true,
      planLimits: { ...cloud.projection.planLimits, maxTeamSeats },
      freeLimits: { ...cloud.projection.freeLimits, maxTeamSeats: 1 },
    },
  }
  const existing = await testDb.select({ id: settings.id }).from(settings)
  if (existing.length === 0) {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: `acme-${suffix()}`,
      createdAt: new Date(),
      cloud: projection,
    })
  } else {
    await testDb.update(settings).set({ cloud: projection }).where(eq(settings.id, existing[0].id))
  }
  invalidateTierLimitsCache()
}

describe.skipIf(!fixture.available)('acceptInvitationFn seat backstop', () => {
  beforeEach(async () => {
    await fixture.begin()
    hoisted.getSession.mockReset()
    invalidateTierLimitsCache()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('refuses accept when members already fill the purchased cap and leaves the invite pending', async () => {
    const before = await countSeatUsage()
    const inviterId = await seedMember(`inviter-${suffix()}@acme.test`)
    await projectMaxTeamSeats(before.members + 1)

    const email = `invitee-${suffix()}@acme.test`
    const inviteeId = await seedUser(email)
    const invitationId = createId('invite')
    await testDb.insert(invitation).values({
      id: invitationId,
      email,
      status: 'pending',
      kind: 'team',
      role: 'member',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      inviterId,
    })

    hoisted.getSession.mockResolvedValue({
      session: { id: 'sess_1' },
      user: { id: inviteeId, email, name: 'Invitee', createdAt: new Date().toISOString() },
    })

    await expect(acceptInvitationFn({ data: { invitationId } })).rejects.toBeInstanceOf(
      TierLimitError
    )

    const [row] = await testDb
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, invitationId))
    expect(row?.status).toBe('pending')

    const seated = await testDb.query.principal.findFirst({
      where: eq(principal.userId, inviteeId),
    })
    expect(seated).toBeUndefined()
  })
})
