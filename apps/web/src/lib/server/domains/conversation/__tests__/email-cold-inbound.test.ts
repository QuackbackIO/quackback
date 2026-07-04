/**
 * Real-DB coverage for cold-inbound sender resolution (§4.8 Layer 2): the DMARC
 * verdict + the identity model decide attach / create-lead / drop. Runs inside the
 * db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { user, principal, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { resolveColdInboundSender } from '../conversation.email-cold-inbound'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const PASS = 'mx; dmarc=pass (p=reject) header.from=acme.com'
const REJECT = 'mx; dmarc=fail (p=reject) header.from=acme.com'
const WEAK = 'mx; dmarc=fail (p=none) header.from=acme.com'

async function seedUser(email: string): Promise<UserId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}`, email })
  return userId
}

describe.skipIf(!fixture.available)('resolveColdInboundSender (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('drops a hard DMARC reject without creating anything', async () => {
    const before = (await testDb.select({ id: principal.id }).from(principal)).length
    const res = await resolveColdInboundSender('spoof@acme.com', REJECT)
    expect(res).toMatchObject({ action: 'drop' })
    const after = (await testDb.select({ id: principal.id }).from(principal)).length
    expect(after).toBe(before) // no principal minted
  })

  it('attaches a DMARC pass to an existing user by address (verified)', async () => {
    const email = `known-${suffix()}@acme.com`
    const userId = await seedUser(email)

    const res = await resolveColdInboundSender(email.toUpperCase(), PASS) // case-insensitive
    expect(res).toMatchObject({ action: 'attach', unverified: false })
    // The principal returned belongs to that user.
    if (res.action === 'attach') {
      const [p] = await testDb
        .select({ userId: principal.userId })
        .from(principal)
        .where(eq(principal.id, res.principalId))
      expect(p.userId).toBe(userId)
    }
  })

  it('creates a verified lead on a DMARC pass with no existing account', async () => {
    const email = `stranger-${suffix()}@acme.com`
    const res = await resolveColdInboundSender(email, PASS)
    expect(res).toMatchObject({ action: 'create', unverified: false })
    if (res.action === 'create') {
      const [p] = await testDb
        .select({ type: principal.type, contactEmail: principal.contactEmail })
        .from(principal)
        .where(eq(principal.id, res.principalId))
      expect(p.type).toBe('anonymous')
      expect(p.contactEmail).toBe(email.toLowerCase())
    }
  })

  it('creates an UNVERIFIED lead on weak auth (badge), never attaching', async () => {
    const email = `weak-${suffix()}@acme.com`
    // Even if a user exists, weak auth must not attach to it.
    await seedUser(email)
    const res = await resolveColdInboundSender(email, WEAK)
    expect(res).toMatchObject({ action: 'create', unverified: true })
    if (res.action === 'create') {
      const [p] = await testDb
        .select({ userId: principal.userId })
        .from(principal)
        .where(eq(principal.id, res.principalId))
      expect(p.userId).toBeNull() // a standalone lead, not the existing user
    }
  })
})
