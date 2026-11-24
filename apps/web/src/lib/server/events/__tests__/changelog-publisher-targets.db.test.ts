/**
 * Real-DB coverage for who a changelog announcement reaches and where it links.
 *
 * CHG-S-11: the publisher is not told about their own announcement. Every
 * publish path (create, update, the scheduled job, the reconciler) builds the
 * event actor from a principal id alone, which makes it a `service` actor, so
 * the "don't notify yourself" match has to work on the principal id for any
 * actor type.
 *
 * CHG-S-14: the email button and the bell open the entry, not the index.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ChangelogId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogEntries, changelogSubscriptions, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: vi.fn().mockResolvedValue({
    audience: 'public',
    showInNav: true,
    allowComments: true,
    autoSubscribe: false,
    emailsDisabled: false,
  }),
}))
vi.mock('@/lib/server/domains/channel-accounts/sender-resolver', () => ({
  resolveSender: vi.fn().mockResolvedValue(null),
}))

import { buildEventActor } from '../dispatch'
import { getChangelogSubscriberTargets } from '../targets'
import type { EventActor, EventData } from '../types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogSubscriptions.id }).from(changelogSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedSubscriber(role: 'admin' | 'user'): Promise<{
  principalId: PrincipalId
  email: string
}> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const email = `cl-${role}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: role, email })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: role,
    createdAt: new Date(),
  })
  await testDb.insert(changelogSubscriptions).values({ principalId, source: 'admin' })
  return { principalId, email }
}

async function seedEntry(): Promise<ChangelogId> {
  const [entry] = await testDb
    .insert(changelogEntries)
    .values({ title: 'Dark mode shipped', content: 'body', publishedAt: new Date() })
    .returning()
  return entry.id as ChangelogId
}

async function targetsFor(changelogId: ChangelogId, actor: EventActor) {
  const event = {
    type: 'changelog.published',
    actor,
    data: {
      changelog: {
        id: changelogId,
        title: 'Dark mode shipped',
        contentPreview: 'body',
        contentHtml: '<p>body</p>',
        publishedAt: new Date().toISOString(),
        linkedPostCount: 0,
      },
    },
  } as unknown as EventData
  return getChangelogSubscriberTargets(event, {
    workspaceName: 'Acme',
    portalBaseUrl: 'https://acme.test',
    logoUrl: null,
  })
}

const emailsOf = (targets: Awaited<ReturnType<typeof targetsFor>>) =>
  targets.filter((t) => t.type === 'email').map((t) => (t.target as { email: string }).email)

const bellRecipientsOf = (targets: Awaited<ReturnType<typeof targetsFor>>) =>
  targets
    .filter((t) => t.type === 'notification')
    .flatMap((t) => (t.target as { principalIds: string[] }).principalIds)

describe.skipIf(!fixture.available)('changelog announcement targets (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('CHG-S-11 a subscribed publisher gets neither the email nor the bell', async () => {
    const publisher = await seedSubscriber('admin')
    const reader = await seedSubscriber('user')
    const entryId = await seedEntry()

    // What createChangelog, updateChangelog, the scheduled job and the
    // reconciler all build: a principal id and nothing else.
    const targets = await targetsFor(
      entryId,
      buildEventActor({ principalId: publisher.principalId })
    )

    expect(emailsOf(targets)).toContain(reader.email)
    expect(emailsOf(targets)).not.toContain(publisher.email)
    expect(bellRecipientsOf(targets)).toContain(reader.principalId)
    expect(bellRecipientsOf(targets)).not.toContain(publisher.principalId)
  })

  it('CHG-S-11 a service actor with no principal still reaches every subscriber', async () => {
    const reader = await seedSubscriber('user')
    const entryId = await seedEntry()

    const targets = await targetsFor(entryId, { type: 'service', displayName: 'scheduler' })

    expect(emailsOf(targets)).toContain(reader.email)
  })

  it('CHG-S-14 the email button and the bell link to the entry itself', async () => {
    await seedSubscriber('user')
    const entryId = await seedEntry()

    const targets = await targetsFor(entryId, { type: 'service', displayName: 'scheduler' })

    const urls = targets.map((t) => (t.config as { changelogUrl?: string }).changelogUrl)
    expect(urls.length).toBeGreaterThan(1)
    for (const url of urls) expect(url).toBe(`https://acme.test/changelog/${entryId}`)
  })
})
