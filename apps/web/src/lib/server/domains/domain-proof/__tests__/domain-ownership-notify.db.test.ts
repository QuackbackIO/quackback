/**
 * Who is told when a domain added by name loses its ownership record, and
 * what they are told, against a real database rolled back after each test.
 * Emails are recorded rather than sent.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { and, eq, inAppNotifications, inArray, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const sent = vi.hoisted(() => ({ emails: [] as Record<string, unknown>[], fail: false }))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  isEmailConfigured: () => true,
  sendDomainAttentionEmail: async (params: Record<string, unknown>) => {
    if (sent.fail) throw new Error('provider down')
    sent.emails.push(params)
    return { sent: true }
  },
}))

import {
  notifyDomainOwnershipLapsed,
  notifyDomainOwnershipMissing,
} from '../domain-ownership-notify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: inAppNotifications.id }).from(inAppNotifications).limit(0)
  },
})

const domain = { name: 'acme.com', ownershipToken: 'abc123' }

async function seedPerson(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function bellsFor(people: PrincipalId[]) {
  return testDb
    .select()
    .from(inAppNotifications)
    .where(
      and(
        inArray(inAppNotifications.principalId, people),
        eq(inAppNotifications.type, 'domain_needs_attention')
      )
    )
}

describe.skipIf(!fixture.available)('domain ownership notices (real DB, rolled back)', () => {
  beforeEach(async () => {
    sent.emails.length = 0
    sent.fail = false
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('warns whoever may manage domains, with the record and the date', async () => {
    const admin = await seedPerson('admin')
    const member = await seedPerson('member')

    expect(await notifyDomainOwnershipMissing(domain, new Date('2026-11-08T06:00:00Z'))).toBe(true)

    const bells = await bellsFor([admin, member])
    expect(bells.map((b) => [b.principalId, b.title, b.body])).toEqual([
      [
        admin,
        'acme.com needs attention',
        'The ownership record (TXT _quackback.acme.com) is missing. Add it back by November 8, 2026 to keep acme.com verified.',
      ],
    ])
    expect(sent.emails).toHaveLength(1)
    expect(sent.emails[0]).toMatchObject({
      domain: 'acme.com',
      record: { name: '_quackback.acme.com', value: 'quackback-domain-verification=abc123' },
      deadline: 'November 8, 2026',
    })
  })

  it('says the warning was not delivered when every email failed, so it is tried again', async () => {
    await seedPerson('admin')
    sent.fail = true
    expect(await notifyDomainOwnershipMissing(domain, new Date('2026-11-08T06:00:00Z'))).toBe(false)
  })

  it('names the sign-in domains that stopped with it', async () => {
    const admin = await seedPerson('admin')

    await notifyDomainOwnershipLapsed(domain, ['acme.com', 'eu.acme.com'])

    const bells = await bellsFor([admin])
    expect(bells.map((b) => [b.title, b.body])).toEqual([
      [
        'acme.com is no longer verified',
        'The ownership record (TXT _quackback.acme.com) is still missing. Sign-in is no longer verified for acme.com, eu.acme.com.',
      ],
    ])
    expect(sent.emails[0]).toMatchObject({ signInDomains: ['acme.com', 'eu.acme.com'] })
  })
})
