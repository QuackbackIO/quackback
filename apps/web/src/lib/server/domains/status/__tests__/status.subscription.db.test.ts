/**
 * The admin subscribe paths (manual add, CSV import) against real Postgres:
 * the opt-out guard is an ON CONFLICT ... WHERE, so only the database can
 * prove that someone who unsubscribed stays unsubscribed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, isNull, principal, statusSubscriptions, user } from '@/lib/server/db'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  addStatusSubscriberByEmail,
  importStatusSubscribersFromEmails,
  removeStatusSubscriberByAdmin,
  subscribe,
  unsubscribe,
} from '../status.subscription'

const limits = vi.hoisted(() => ({ cap: null as number | null }))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ maxStatusSubscribers: limits.cap }),
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusSubscriptions.id }).from(statusSubscriptions).limit(0)
  },
})

async function person(email: string): Promise<PrincipalId> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: email, email })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

async function subscription(principalId: PrincipalId) {
  return testDb.query.statusSubscriptions.findFirst({
    where: eq(statusSubscriptions.principalId, principalId),
  })
}

describe('admin subscribe paths (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)

  it('adding someone who unsubscribed skips them and keeps the opt-out', async () => {
    const id = await person('optedout@example.com')
    await subscribe(id, 'page', [], 'self_serve')
    await unsubscribe(id)

    expect(await addStatusSubscriberByEmail('OptedOut@example.com')).toEqual({ subscribed: false })
    expect((await subscription(id))?.unsubscribedAt).not.toBeNull()
  })

  it('adding someone new or already subscribed subscribes them', async () => {
    const fresh = await person('fresh@example.com')
    const active = await person('active@example.com')
    await subscribe(active, 'page', [], 'self_serve')

    expect(await addStatusSubscriberByEmail('fresh@example.com')).toEqual({ subscribed: true })
    expect(await addStatusSubscriberByEmail('active@example.com')).toEqual({ subscribed: true })
    expect(await subscription(fresh)).toMatchObject({ source: 'admin', unsubscribedAt: null })
    expect(await subscription(active)).toMatchObject({ source: 'self_serve', unsubscribedAt: null })
  })

  it('an import skips people who unsubscribed and reports them apart', async () => {
    const optedOut = await person('optedout@example.com')
    await person('known@example.com')
    await subscribe(optedOut, 'page', [], 'self_serve')
    await unsubscribe(optedOut)

    const result = await importStatusSubscribersFromEmails([
      'optedout@example.com',
      'known@example.com',
      'ghost@example.com',
    ])

    expect(result).toEqual({ imported: 1, skipped: 1, optedOut: 1, total: 3 })
    expect((await subscription(optedOut))?.unsubscribedAt).not.toBeNull()
  })

  it('a person can still re-subscribe themselves after opting out', async () => {
    const id = await person('back@example.com')
    await subscribe(id, 'page', [], 'self_serve')
    await unsubscribe(id)
    await subscribe(id, 'page', [], 'self_serve')

    expect((await subscription(id))?.unsubscribedAt).toBeNull()
  })
})

async function activeSubscriberCount(): Promise<number> {
  const rows = await testDb
    .select({ id: statusSubscriptions.id })
    .from(statusSubscriptions)
    .where(isNull(statusSubscriptions.unsubscribedAt))
  return rows.length
}

describe('admin removal (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    limits.cap = null
    await fixture.begin()
  })
  afterEach(fixture.rollback)

  it('unsubscribes an active subscriber and keeps the row', async () => {
    const id = await person('removed@example.com')
    await subscribe(id, 'page', [], 'self_serve')

    expect(await removeStatusSubscriberByAdmin(id)).toEqual({ removed: true })
    const row = await subscription(id)
    expect(row).toBeDefined()
    expect(row?.unsubscribedAt).not.toBeNull()
    expect(row?.source).toBe('self_serve')
  })

  it('leaves an existing opt-out and its original time untouched', async () => {
    const id = await person('optedout@example.com')
    await subscribe(id, 'page', [], 'self_serve')
    await unsubscribe(id)
    const before = (await subscription(id))?.unsubscribedAt

    expect(await removeStatusSubscriberByAdmin(id)).toEqual({ removed: false })
    expect((await subscription(id))?.unsubscribedAt).toEqual(before)
  })

  it('reports nothing removed for a person with no subscription', async () => {
    const id = await person('never@example.com')

    expect(await removeStatusSubscriberByAdmin(id)).toEqual({ removed: false })
    expect(await subscription(id)).toBeUndefined()
  })

  it('frees a slot at the cap so another person can subscribe', async () => {
    limits.cap = 1
    const [a, b] = [await person('a@example.com'), await person('b@example.com')]
    await subscribe(a, 'page', [], 'self_serve')
    await expect(subscribe(b, 'page', [], 'self_serve')).rejects.toBeInstanceOf(TierLimitError)

    await removeStatusSubscriberByAdmin(a)
    await expect(subscribe(b, 'page', [], 'self_serve')).resolves.toBeUndefined()
    expect(await activeSubscriberCount()).toBe(1)
  })

  it('keeps the opt-out for admin adds, and lets the person re-subscribe themselves', async () => {
    const id = await person('back@example.com')
    await subscribe(id, 'page', [], 'self_serve')
    await removeStatusSubscriberByAdmin(id)

    expect(await addStatusSubscriberByEmail('back@example.com')).toEqual({ subscribed: false })

    await subscribe(id, 'page', [], 'self_serve')
    expect((await subscription(id))?.unsubscribedAt).toBeNull()
  })
})

describe('status subscriber cap (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    limits.cap = null
    await fixture.begin()
  })
  afterEach(fixture.rollback)

  it('refuses a new self-serve subscriber once the cap is reached', async () => {
    limits.cap = 2
    const [a, b, c] = [
      await person('a@example.com'),
      await person('b@example.com'),
      await person('c@example.com'),
    ]
    await subscribe(a, 'page', [], 'self_serve')
    await subscribe(b, 'page', [], 'self_serve')

    await expect(subscribe(c, 'page', [], 'self_serve')).rejects.toBeInstanceOf(TierLimitError)
    expect(await subscription(c)).toBeUndefined()
    expect(await activeSubscriberCount()).toBe(2)
  })

  it('lets an existing active subscriber change scope at the cap', async () => {
    limits.cap = 1
    const a = await person('a@example.com')
    await subscribe(a, 'page', [], 'self_serve')

    await expect(subscribe(a, 'page', [], 'self_serve')).resolves.toBeUndefined()
    expect(await activeSubscriberCount()).toBe(1)
  })

  it('does not count opted-out rows against the cap', async () => {
    limits.cap = 1
    const a = await person('a@example.com')
    const b = await person('b@example.com')
    await subscribe(a, 'page', [], 'self_serve')
    await unsubscribe(a)

    await expect(subscribe(b, 'page', [], 'self_serve')).resolves.toBeUndefined()
    expect(await activeSubscriberCount()).toBe(1)
  })

  it('refuses reactivating an opted-out person when the slot has been taken', async () => {
    limits.cap = 1
    const a = await person('a@example.com')
    const b = await person('b@example.com')
    await subscribe(a, 'page', [], 'self_serve')
    await unsubscribe(a)
    await subscribe(b, 'page', [], 'self_serve')

    await expect(subscribe(a, 'page', [], 'self_serve')).rejects.toBeInstanceOf(TierLimitError)
    expect((await subscription(a))?.unsubscribedAt).not.toBeNull()
  })

  it('never removes existing subscribers when the cap is lowered below them', async () => {
    const ids = [
      await person('a@example.com'),
      await person('b@example.com'),
      await person('c@example.com'),
    ]
    for (const id of ids) await subscribe(id, 'page', [], 'self_serve')
    limits.cap = 1
    const late = await person('late@example.com')

    await expect(subscribe(late, 'page', [], 'self_serve')).rejects.toBeInstanceOf(TierLimitError)
    expect(await activeSubscriberCount()).toBe(3)
  })

  it('refuses an admin add at the cap and leaves the list unchanged', async () => {
    limits.cap = 1
    const a = await person('a@example.com')
    await subscribe(a, 'page', [], 'self_serve')
    await person('fresh@example.com')

    await expect(addStatusSubscriberByEmail('fresh@example.com')).rejects.toBeInstanceOf(
      TierLimitError
    )
    expect(await activeSubscriberCount()).toBe(1)
  })

  it('imports a CSV only when every new subscriber fits, all or nothing', async () => {
    limits.cap = 2
    const a = await person('a@example.com')
    await subscribe(a, 'page', [], 'self_serve')
    const fresh1 = await person('fresh1@example.com')
    await person('fresh2@example.com')

    await expect(
      importStatusSubscribersFromEmails(['fresh1@example.com', 'fresh2@example.com'])
    ).rejects.toBeInstanceOf(TierLimitError)
    expect(await subscription(fresh1)).toBeUndefined()
    expect(await activeSubscriberCount()).toBe(1)
  })

  it('imports within the cap and still treats opted-out and unknown emails as before', async () => {
    limits.cap = 3
    const fresh = await person('fresh@example.com')
    const optedOut = await person('optedout@example.com')
    await subscribe(optedOut, 'page', [], 'self_serve')
    await unsubscribe(optedOut)

    const result = await importStatusSubscribersFromEmails([
      'fresh@example.com',
      'optedout@example.com',
      'nobody@example.com',
    ])
    expect(result).toEqual({ imported: 1, skipped: 1, optedOut: 1, total: 3 })
    expect(await subscription(fresh)).toMatchObject({ source: 'csv_import', unsubscribedAt: null })
  })
})

afterAll(fixture.close)
