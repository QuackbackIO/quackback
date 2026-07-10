/**
 * Real-DB coverage for findContactsByEmail (the "New person" dedup lookup).
 *
 * The lookup spans two sources with different uniqueness rules — user.email
 * (at most one row, all writers lowercase) and principal.contactEmail (no
 * uniqueness: multiple anonymous leads can share an address) — so only
 * Postgres can prove the queries return EVERY match and stay
 * case-insensitive. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { findContactsByEmail } from '../user.dedup'

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

describe.skipIf(!fixture.available)('findContactsByEmail', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('returns a verified user match with its emailVerified state', async () => {
    const email = `verified-${runSuffix()}@example.com`
    const seeded = await seedUser({ name: 'Vera Verified', email, emailVerified: true })

    const matches = await findContactsByEmail(email)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'verified_user',
      principalId: seeded.principalId,
      userId: seeded.userId,
      name: 'Vera Verified',
      email,
    })
  })

  it('returns an unverified user match', async () => {
    const email = `unverified-${runSuffix()}@example.com`
    const seeded = await seedUser({ name: 'Ursula Unverified', email, emailVerified: false })

    const matches = await findContactsByEmail(email)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      type: 'unverified_user',
      principalId: seeded.principalId,
    })
  })

  it('returns EVERY lead sharing the email (contactEmail is not unique)', async () => {
    const email = `shared-lead-${runSuffix()}@example.com`
    const leadA = await seedLead({ name: 'Laptop visitor', contactEmail: email })
    const leadB = await seedLead({ name: 'Phone visitor', contactEmail: email })
    const leadC = await seedLead({ name: null, contactEmail: email })

    const matches = await findContactsByEmail(email)

    expect(matches).toHaveLength(3)
    expect(matches.every((m) => m.type === 'lead')).toBe(true)
    expect(new Set(matches.map((m) => m.principalId))).toEqual(
      new Set([leadA.principalId, leadB.principalId, leadC.principalId])
    )
    // Nameless leads still render
    expect(matches.find((m) => m.principalId === leadC.principalId)?.name).toBe(
      'Anonymous visitor'
    )
  })

  it('returns mixed user + lead matches together', async () => {
    const email = `mixed-${runSuffix()}@example.com`
    const userSeed = await seedUser({ name: 'Mixed User', email, emailVerified: false })
    const leadSeed = await seedLead({ name: 'Mixed Lead', contactEmail: email })

    const matches = await findContactsByEmail(email)

    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.type).sort()).toEqual(['lead', 'unverified_user'])
    expect(new Set(matches.map((m) => m.principalId))).toEqual(
      new Set([userSeed.principalId, leadSeed.principalId])
    )
  })

  it('matches case-insensitively across both sources', async () => {
    const local = `case-${runSuffix()}`
    // Stored lowercase (the writers' convention)…
    const userSeed = await seedUser({ name: 'Cased User', email: `${local}@example.com` })
    // …and a lead stored with mixed case (defensive: prove LOWER() on the column too)
    const leadSeed = await seedLead({
      name: 'Cased Lead',
      contactEmail: `${local.toUpperCase()}@Example.COM`,
    })

    const matches = await findContactsByEmail(`  ${local.toUpperCase()}@EXAMPLE.COM `)

    expect(new Set(matches.map((m) => m.principalId))).toEqual(
      new Set([userSeed.principalId, leadSeed.principalId])
    )
  })

  it('ignores leads without a contact email and unrelated addresses', async () => {
    const email = `lonely-${runSuffix()}@example.com`
    await seedLead({ name: 'No email lead', contactEmail: null })
    await seedUser({ name: 'Other User', email: `other-${runSuffix()}@example.com` })

    expect(await findContactsByEmail(email)).toEqual([])
    expect(await findContactsByEmail('   ')).toEqual([])
  })
})
