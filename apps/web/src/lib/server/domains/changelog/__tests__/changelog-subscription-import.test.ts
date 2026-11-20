/**
 * CHG-S-26: admin CSV import of changelog subscribers, against a real DB so
 * the upsert's conflict behaviour is what Postgres actually does.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogSubscriptions, principal, user } from '@/lib/server/db'
import {
  getChangelogSubscriptionStatus,
  importChangelogSubscribersFromEmails,
  unsubscribeChangelog,
} from '../changelog-subscription.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: changelogSubscriptions.principalId, at: changelogSubscriptions.unsubscribedAt })
      .from(changelogSubscriptions)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(): Promise<{ principalId: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const email = `csv-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: 'Reader', email })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Reader',
    createdAt: new Date(),
  })
  return { principalId, email }
}

describe.skipIf(!fixture.available)('changelog CSV subscriber import (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('CHG-S-26 subscribes matched accounts case-insensitively and skips unknown addresses', async () => {
    const person = await seedPerson()

    const result = await importChangelogSubscribersFromEmails([
      person.email.toUpperCase(),
      ` ${person.email} `,
      `nobody-${suffix()}@example.com`,
    ])

    expect(result).toEqual({ imported: 1, skipped: 1, optedOut: 0, total: 2 })
    expect(await getChangelogSubscriptionStatus(person.principalId)).toMatchObject({
      subscribed: true,
      source: 'csv_import',
    })
  })
  it('CHG-S-26 importing someone who unsubscribed leaves them unsubscribed', async () => {
    const person = await seedPerson()
    await unsubscribeChangelog(person.principalId)

    const result = await importChangelogSubscribersFromEmails([person.email])

    expect(result).toEqual({ imported: 0, skipped: 0, optedOut: 1, total: 1 })
    expect(await getChangelogSubscriptionStatus(person.principalId)).toMatchObject({
      subscribed: false,
    })
  })
})
