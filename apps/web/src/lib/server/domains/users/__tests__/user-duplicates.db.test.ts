/**
 * Real-DB coverage for findDuplicatesForPrincipal (the profile
 * possible-duplicates lookup). Name matching rides the pg_trgm similarity()
 * function and email matching crosses two sources (user.email and
 * principal.contactEmail), so only Postgres can prove the thresholds and the
 * union of match reasons. Owns its own fixture: db-test-fixture allows one
 * fixture per file. Runs inside the rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { findDuplicatesForPrincipal } from '../user.dedup'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, email: principal.contactEmail, type: principal.type })
      .from(principal)
      .limit(0)
    await db
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(opts: {
  name: string
  email: string | null
  emailVerified?: boolean
}): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name,
    email: opts.email,
    emailVerified: opts.emailVerified ?? false,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: opts.name,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

async function seedLead(opts: {
  name: string | null
  contactEmail: string | null
}): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name ?? 'Anonymous',
    email: `temp-${runSuffix()}@anon.quackback.io`,
    isAnonymous: true,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'anonymous',
    displayName: opts.name,
    contactEmail: opts.contactEmail,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

describe.skipIf(!fixture.available)('findDuplicatesForPrincipal', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('flags a lead whose contact email matches the user email (cross-source)', async () => {
    const email = `dup-cross-${runSuffix()}@example.com`
    const self = await seedUser({ name: 'Dana Cross', email })
    const lead = await seedLead({ name: 'Dana from widget', contactEmail: email })

    const matches = await findDuplicatesForPrincipal(self.principalId)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      principalId: lead.principalId,
      isLead: true,
      // The lead's reachable address is the captured contact email, not the
      // synthetic placeholder on its user row.
      email,
      reasons: ['email'],
    })
  })

  it('flags a user whose email matches the lead contact email (reverse direction)', async () => {
    const email = `dup-rev-${runSuffix()}@example.com`
    const self = await seedLead({ name: 'Widget visitor', contactEmail: email })
    const other = await seedUser({ name: 'Rita Reverse', email })

    const matches = await findDuplicatesForPrincipal(self.principalId)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      principalId: other.principalId,
      isLead: false,
      reasons: ['email'],
    })
  })

  it('flags a near-identical display name with the name reason', async () => {
    const tag = runSuffix()
    const self = await seedUser({
      name: `Jon Smyth ${tag}`,
      email: `jon-${tag}@example.com`,
    })
    const near = await seedUser({
      name: `John Smyth ${tag}`,
      email: `john-${tag}@example.com`,
    })
    // Clearly different name: must NOT match.
    await seedUser({ name: `Zelda Faraway ${tag}`, email: `zelda-${tag}@example.com` })

    const matches = await findDuplicatesForPrincipal(self.principalId)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ principalId: near.principalId, reasons: ['name'] })
  })

  it('unions reasons when email and name both match, and never returns self', async () => {
    const tag = runSuffix()
    const email = `dup-both-${tag}@example.com`
    const self = await seedUser({ name: `Sam Pair ${tag}`, email })
    const other = await seedLead({ name: `Sam Pair ${tag}`, contactEmail: email })

    const matches = await findDuplicatesForPrincipal(self.principalId)

    expect(matches).toHaveLength(1)
    expect(matches[0].principalId).toBe(other.principalId)
    expect([...matches[0].reasons].sort()).toEqual(['email', 'name'])
    expect(matches.some((m) => m.principalId === self.principalId)).toBe(false)
  })

  it('returns [] for an unknown principal and for a lonely one', async () => {
    const self = await seedUser({
      name: `Solo ${runSuffix()}`,
      email: `solo-${runSuffix()}@example.com`,
    })

    expect(await findDuplicatesForPrincipal(self.principalId)).toEqual([])
    expect(await findDuplicatesForPrincipal(createId('principal') as PrincipalId)).toEqual([])
  })
})
