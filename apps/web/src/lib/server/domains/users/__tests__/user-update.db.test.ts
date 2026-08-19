/**
 * Real-DB coverage for updatePortalUserProfile (the admin profile edit).
 *
 * The lead arm writes principal.contactEmail — an OVERWRITE, deliberately
 * unlike the capture-once widget paths, because an admin correcting a typo
 * must be able to replace an address already on file — and the edit must
 * immediately re-key the duplicate detection (findDuplicatesForPrincipal
 * reads contactEmail). Only Postgres proves both the write and the re-match.
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { updatePortalUserProfile } from '../user.update'
import { findDuplicatesForPrincipal } from '../user.dedup'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, email: principal.contactEmail, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id, email: user.email }).from(user).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(opts: {
  name: string
  email: string | null
}): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name,
    email: opts.email,
    emailVerified: false,
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
}): Promise<{ userId: UserId; principalId: PrincipalId; placeholderEmail: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const placeholderEmail = `temp-${runSuffix()}@anon.quackback.io`
  await testDb.insert(user).values({
    id: userId,
    name: opts.name ?? 'Anonymous',
    email: placeholderEmail,
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
  return { userId, principalId, placeholderEmail }
}

describe.skipIf(!fixture.available)('updatePortalUserProfile', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('sets a contact email on a lead that has none', async () => {
    const lead = await seedLead({ name: 'Window shopper', contactEmail: null })
    const email = `new-lead-${runSuffix()}@example.com`

    await updatePortalUserProfile({ principalId: lead.principalId, email })

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBe(email)
  })

  it('overwrites an existing contact email (admin correction, not capture-once)', async () => {
    const lead = await seedLead({
      name: 'Typo visitor',
      contactEmail: `typo-${runSuffix()}@example.com`,
    })
    const corrected = `fixed-${runSuffix()}@example.com`

    await updatePortalUserProfile({ principalId: lead.principalId, email: corrected })

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBe(corrected)
  })

  it('never touches the lead placeholder user.email', async () => {
    const lead = await seedLead({ name: 'Placeholder guard', contactEmail: null })

    await updatePortalUserProfile({
      principalId: lead.principalId,
      email: `guard-${runSuffix()}@example.com`,
    })

    const [row] = await testDb
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, lead.userId))
    expect(row.email).toBe(lead.placeholderEmail)
  })

  it('clears the contact email on null', async () => {
    const lead = await seedLead({
      name: 'Clear me',
      contactEmail: `clear-${runSuffix()}@example.com`,
    })

    await updatePortalUserProfile({ principalId: lead.principalId, email: null })

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBeNull()
  })

  it('rejects an undeliverable address without writing anything', async () => {
    const before = `keep-${runSuffix()}@example.com`
    const lead = await seedLead({ name: 'Bad address', contactEmail: before })

    await expect(
      updatePortalUserProfile({ principalId: lead.principalId, email: 'not-an-email' })
    ).rejects.toThrow()

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(row.contactEmail).toBe(before)
  })

  it('refuses a synthetic anon placeholder as a contact email', async () => {
    const lead = await seedLead({ name: 'Synthetic guard', contactEmail: null })

    await expect(
      updatePortalUserProfile({
        principalId: lead.principalId,
        email: `temp-${runSuffix()}@anon.quackback.io`,
      })
    ).rejects.toThrow()
  })

  it('re-keys duplicate detection: a lead edited onto a user address matches that user', async () => {
    const shared = `dupe-${runSuffix()}@example.com`
    const existing = await seedUser({ name: 'Existing Person', email: shared })
    const lead = await seedLead({ name: 'Unmatched visitor', contactEmail: null })

    expect(await findDuplicatesForPrincipal(lead.principalId)).toHaveLength(0)

    await updatePortalUserProfile({ principalId: lead.principalId, email: shared })

    const matches = await findDuplicatesForPrincipal(lead.principalId)
    const byEmail = matches.find((m) => m.principalId === existing.principalId)
    expect(byEmail).toBeDefined()
    expect(byEmail?.reasons).toContain('email')
  })

  it('drops a stale duplicate once the lead email is corrected away', async () => {
    const shared = `stale-${runSuffix()}@example.com`
    const existing = await seedUser({ name: 'Other Person', email: shared })
    const lead = await seedLead({ name: 'Wrongly matched', contactEmail: shared })

    expect(
      (await findDuplicatesForPrincipal(lead.principalId)).some(
        (m) => m.principalId === existing.principalId
      )
    ).toBe(true)

    await updatePortalUserProfile({
      principalId: lead.principalId,
      email: `unique-${runSuffix()}@example.com`,
    })

    expect(
      (await findDuplicatesForPrincipal(lead.principalId)).some(
        (m) => m.principalId === existing.principalId
      )
    ).toBe(false)
  })

  it('keeps the identified-user behaviour: account email with uniqueness guard', async () => {
    const taken = `taken-${runSuffix()}@example.com`
    await seedUser({ name: 'First Person', email: taken })
    const second = await seedUser({ name: 'Second Person', email: null })

    await expect(
      updatePortalUserProfile({ principalId: second.principalId, email: taken })
    ).rejects.toThrow(/already in use/i)

    const own = `own-${runSuffix()}@example.com`
    await updatePortalUserProfile({ principalId: second.principalId, email: own })
    const [row] = await testDb
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, second.userId))
    expect(row.email).toBe(own)
  })

  it('updates the display name on user and principal', async () => {
    const lead = await seedLead({ name: 'Old Name', contactEmail: null })

    await updatePortalUserProfile({ principalId: lead.principalId, name: 'New Name' })

    const [u] = await testDb.select({ name: user.name }).from(user).where(eq(user.id, lead.userId))
    const [p] = await testDb
      .select({ displayName: principal.displayName })
      .from(principal)
      .where(eq(principal.id, lead.principalId))
    expect(u.name).toBe('New Name')
    expect(p.displayName).toBe('New Name')
  })

  it('throws NotFoundError for an unknown principal', async () => {
    await expect(
      updatePortalUserProfile({
        principalId: createId('principal') as PrincipalId,
        email: `ghost-${runSuffix()}@example.com`,
      })
    ).rejects.toThrow(/not found/i)
  })
})
