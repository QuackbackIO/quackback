/**
 * Seat usage is a count against live roster + invite rows, not a stub.
 * Pending team invites hold a seat; portal invites and service principals
 * do not. The purchased cap is the projected maxTeamSeats limit.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, invitation, principal, settings, sql, user } from '@/lib/server/db'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => ({
  getCloudConfig: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: () => hoisted.getCloudConfig(),
}))

const { countSeatUsage } = await import('../seat-usage')
const { enforceSeatLimit } = await import('../seat-limit')
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

async function seedUserOnly(): Promise<UserId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Inviter',
    email: `inviter-${suffix()}@acme.test`,
  })
  return userId
}

async function seedHuman(role: 'admin' | 'member' | 'user'): Promise<UserId> {
  const userId = await seedUserOnly()
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role,
    type: 'user',
    createdAt: new Date(),
  })
  return userId
}

async function seedServiceAdmin(): Promise<void> {
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId: null,
    role: 'admin',
    type: 'service',
    createdAt: new Date(),
  })
}

async function seedInvite(kind: 'team' | 'portal', inviterId: UserId): Promise<void> {
  await testDb.insert(invitation).values({
    id: createId('invite'),
    email: `${kind}-${suffix()}@acme.test`,
    status: 'pending',
    kind,
    role: kind === 'portal' ? 'user' : 'member',
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    inviterId,
  })
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

describe.skipIf(!fixture.available)('countSeatUsage', () => {
  beforeEach(async () => {
    await fixture.begin()
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'pro',
      trialActive: false,
    })
    invalidateTierLimitsCache()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('counts human admin/member principals and pending team invites, and ignores the rest', async () => {
    const before = await countSeatUsage()
    const inviterId = await seedHuman('admin')
    await seedHuman('member')
    await seedHuman('user')
    await seedServiceAdmin()
    await seedInvite('team', inviterId)
    await seedInvite('team', inviterId)
    await seedInvite('portal', inviterId)

    const after = await countSeatUsage()
    expect(after.members).toBe(before.members + 2)
    expect(after.pendingInvites).toBe(before.pendingInvites + 2)
    expect(after.used).toBe(before.used + 4)
  })

  it('blocks a new invite once purchased seats are held by members plus pending team invites', async () => {
    const before = await countSeatUsage()
    const inviterId = await seedHuman('member')
    await projectMaxTeamSeats(before.used + 2)
    await expect(enforceSeatLimit()).resolves.toBeUndefined()

    await seedInvite('team', inviterId)
    await expect(enforceSeatLimit()).rejects.toBeInstanceOf(TierLimitError)
    await expect(enforceSeatLimit()).rejects.toThrow(
      /All \d+ seats are in use\. Add a seat to invite more\./
    )
  })

  it('refuses a racing accept once members already fill the purchased cap', async () => {
    const before = await countSeatUsage()
    const inviterId = await seedHuman('member')
    await projectMaxTeamSeats(before.members + 2)
    await seedInvite('team', inviterId)
    await expect(enforceSeatLimit({ convertingInvite: true })).resolves.toBeUndefined()

    await seedHuman('member')
    await expect(enforceSeatLimit({ convertingInvite: true })).rejects.toBeInstanceOf(
      TierLimitError
    )
  })

  it('locks the settings row when counting under a transaction executor', async () => {
    const before = await countSeatUsage()
    await projectMaxTeamSeats(before.used + 5)
    await testDb.transaction(async (tx) => {
      await enforceSeatLimit({ executor: tx })
      const held = await tx.execute(sql`
        SELECT l.mode
        FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        WHERE l.pid = pg_backend_pid()
          AND c.relname = 'settings'
          AND l.mode = 'RowShareLock'
      `)
      expect([...(held as unknown as { mode: string }[])].length).toBeGreaterThan(0)
    })
  })

  it('serializes a send-time count with the pending-invite insert', async () => {
    const inviterId = await seedHuman('member')
    const before = await countSeatUsage()
    await projectMaxTeamSeats(before.used + 1)

    await testDb.transaction(async (tx) => {
      await enforceSeatLimit({ executor: tx })
      await tx.insert(invitation).values({
        id: createId('invite'),
        email: `held-${suffix()}@acme.test`,
        status: 'pending',
        kind: 'team',
        role: 'member',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        inviterId,
      })
    })

    await expect(
      testDb.transaction(async (tx) => {
        await enforceSeatLimit({ executor: tx })
        await tx.insert(invitation).values({
          id: createId('invite'),
          email: `race-${suffix()}@acme.test`,
          status: 'pending',
          kind: 'team',
          role: 'member',
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date(),
          inviterId,
        })
      })
    ).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not let portal invites consume a purchased seat', async () => {
    const before = await countSeatUsage()
    const inviterId = await seedUserOnly()
    await projectMaxTeamSeats(before.used + 1)
    await seedInvite('portal', inviterId)
    await seedInvite('portal', inviterId)

    const after = await countSeatUsage()
    expect(after.used).toBe(before.used)
    expect(after.pendingInvites).toBe(before.pendingInvites)
    await expect(enforceSeatLimit()).resolves.toBeUndefined()
  })
})
