/**
 * CHG-S-11: when one teammate publishes another's draft, the announcement is
 * the publisher's. The publisher is left out of the fan-out; the author, if
 * subscribed, hears about it like anyone else.
 *
 * Real DB end to end: updateChangelog publishes, the event actor it builds is
 * captured at dispatch, and that event goes through the real subscriber
 * resolver.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

const dispatched = vi.hoisted(() => ({
  events: [] as Array<{ actor: unknown; changelog: unknown }>,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/events/dispatch')>()),
  dispatchChangelogPublished: vi.fn(async (actor: unknown, changelog: unknown) => {
    dispatched.events.push({ actor, changelog })
  }),
}))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))
vi.mock('../changelog-embedding.service', () => ({
  embedChangelogEntryOnPublish: vi.fn().mockResolvedValue(undefined),
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

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogSubscriptions, principal, user } from '@/lib/server/db'
import { getChangelogSubscriberTargets } from '@/lib/server/events/targets'
import type { EventData } from '@/lib/server/events/types'
import { createChangelog, updateChangelog } from '../changelog.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogSubscriptions.id }).from(changelogSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedSubscribedAdmin(): Promise<{ principalId: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const email = `cl-admin-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: 'Admin', email })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: 'Admin',
    createdAt: new Date(),
  })
  await testDb.insert(changelogSubscriptions).values({ principalId, source: 'admin' })
  return { principalId, email }
}

describe.skipIf(!fixture.available)('changelog publish actor (real DB)', () => {
  beforeEach(async () => {
    dispatched.events.length = 0
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("CHG-S-11 a teammate publishing another's draft is left out; the author is told", async () => {
    const author = await seedSubscribedAdmin()
    const publisher = await seedSubscribedAdmin()
    const draft = await createChangelog(
      { title: 'Dark mode', content: 'Shipped', publishState: { type: 'draft' } },
      { principalId: author.principalId, name: 'Author' }
    )

    await updateChangelog(
      draft.id,
      { publishState: { type: 'published' } },
      { principalId: publisher.principalId }
    )
    await vi.waitFor(() => expect(dispatched.events).toHaveLength(1))

    const [{ actor, changelog }] = dispatched.events
    expect(actor).toMatchObject({ principalId: publisher.principalId })
    const targets = await getChangelogSubscriberTargets(
      {
        type: 'changelog.published',
        actor,
        data: { changelog: { ...(changelog as object), publishedAt: new Date().toISOString() } },
      } as unknown as EventData,
      { workspaceName: 'Acme', portalBaseUrl: 'https://acme.test', logoUrl: null }
    )
    const emails = targets
      .filter((t) => t.type === 'email')
      .map((t) => (t.target as { email: string }).email)
    const bells = targets
      .filter((t) => t.type === 'notification')
      .flatMap((t) => (t.target as { principalIds: string[] }).principalIds)

    expect(emails).toContain(author.email)
    expect(bells).toContain(author.principalId)
    expect(emails).not.toContain(publisher.email)
    expect(bells).not.toContain(publisher.principalId)
  })
})
