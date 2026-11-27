/**
 * Per-entry choice for the widget's "What's new" card above the launcher:
 * entries are announced unless an admin turns it off. Create defaults to on,
 * update leaves the choice alone unless it is given, and the widget's list
 * carries it so the card can skip an entry that is not announced.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ChangelogId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: vi.fn(() => ({ type: 'user' })),
  dispatchChangelogPublished: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../changelog-embedding.service', () => ({
  embedChangelogEntryOnPublish: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { changelogEntries, eq, principal, user } from '@/lib/server/db'
import { createChangelogSchema, updateChangelogSchema } from '@/lib/shared/schemas/changelog'
import { createChangelog, getChangelogById, updateChangelog } from '../changelog.service'
import { getPublicChangelogById, listPublicChangelogs } from '../changelog.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: changelogEntries.id, announce: changelogEntries.announceOnLauncher })
      .from(changelogEntries)
      .limit(0)
  },
})

async function seedAuthor(): Promise<{ principalId: PrincipalId; name: string }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Author' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: 'Author',
    createdAt: new Date(),
  })
  return { principalId, name: 'Author' }
}

async function stored(id: ChangelogId): Promise<boolean> {
  const [row] = await testDb
    .select({ announce: changelogEntries.announceOnLauncher })
    .from(changelogEntries)
    .where(eq(changelogEntries.id, id))
  return row.announce
}

describe.skipIf(!fixture.available)('changelog announce above the launcher (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('create announces by default and keeps an explicit off', async () => {
    const author = await seedAuthor()
    const draft = { type: 'draft' as const }
    const omitted = await createChangelog(
      { title: 'A', content: 'Body', publishState: draft },
      author
    )
    const off = await createChangelog(
      { title: 'B', content: 'Body', publishState: draft, announceOnLauncher: false },
      author
    )

    expect(await stored(omitted.id)).toBe(true)
    expect(omitted.announceOnLauncher).toBe(true)
    expect(await stored(off.id)).toBe(false)
    expect(off.announceOnLauncher).toBe(false)
  })

  it('update leaves the choice alone unless it is given', async () => {
    const author = await seedAuthor()
    const entry = await createChangelog(
      { title: 'A', content: 'Body', publishState: { type: 'draft' }, announceOnLauncher: false },
      author
    )

    await updateChangelog(entry.id, { title: 'Renamed' })
    expect(await stored(entry.id)).toBe(false)

    const on = await updateChangelog(entry.id, { announceOnLauncher: true })
    expect(on.announceOnLauncher).toBe(true)
    expect((await getChangelogById(entry.id)).announceOnLauncher).toBe(true)
  })

  it("the list the widget reads carries each entry's choice", async () => {
    const author = await seedAuthor()
    const published = { type: 'published' as const }
    const on = await createChangelog(
      { title: 'On', content: 'Body', publishState: published },
      author
    )
    const off = await createChangelog(
      { title: 'Off', content: 'Body', publishState: published, announceOnLauncher: false },
      author
    )

    const { items } = await listPublicChangelogs({ limit: 50 })
    const byId = new Map(items.map((e) => [e.id, e.announceOnLauncher]))
    expect(byId.get(on.id)).toBe(true)
    expect(byId.get(off.id)).toBe(false)
  })

  it('leaves the choice out of a single public entry', async () => {
    const author = await seedAuthor()
    const entry = await createChangelog(
      { title: 'On', content: 'Body', publishState: { type: 'published' } },
      author
    )
    expect(await getPublicChangelogById(entry.id)).not.toHaveProperty('announceOnLauncher')
  })
})

describe('announceOnLauncher input', () => {
  it('is an optional boolean on create and update', () => {
    const base = { title: 'A', content: 'Body', publishState: { type: 'draft' } }
    expect(
      createChangelogSchema.safeParse({ ...base, announceOnLauncher: false }).data
    ).toMatchObject({ announceOnLauncher: false })
    expect(createChangelogSchema.safeParse({ ...base, announceOnLauncher: 'no' }).success).toBe(
      false
    )
    expect(
      updateChangelogSchema.safeParse({ id: 'x', announceOnLauncher: true }).data
    ).toMatchObject({
      announceOnLauncher: true,
    })
  })
})
