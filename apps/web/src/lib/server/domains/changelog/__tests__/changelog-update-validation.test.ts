/**
 * CHG-A-33: updateChangelog should refuse an empty body the way
 * createChangelog does, rather than blanking a saved entry.
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
import { createChangelog, updateChangelog } from '../changelog.service'
import { embedChangelogEntryOnPublish } from '../changelog-embedding.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogEntries.id }).from(changelogEntries).limit(0)
  },
})

async function seedEntry(): Promise<ChangelogId> {
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
  const entry = await createChangelog(
    { title: 'Release', content: 'The original body', publishState: { type: 'draft' } },
    { principalId, name: 'Author' }
  )
  return entry.id
}

async function storedContent(id: ChangelogId): Promise<string> {
  const [row] = await testDb
    .select({ content: changelogEntries.content })
    .from(changelogEntries)
    .where(eq(changelogEntries.id, id))
  return row.content
}

describe.skipIf(!fixture.available)('changelog update validation (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('CHG-A-33 create refuses an empty body', async () => {
    await expect(
      createChangelog(
        { title: 'Release', content: '   ', publishState: { type: 'draft' } },
        { principalId: createId('principal') as PrincipalId, name: 'Author' }
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Content is required' })
  })

  it('CHG-A-33 update still saves a non-empty body', async () => {
    const id = await seedEntry()

    await updateChangelog(id, { content: 'A new body' })

    expect(await storedContent(id)).toBe('A new body')
  })
  it('CHG-A-33 update refuses an empty body like create does', async () => {
    const id = await seedEntry()

    await expect(updateChangelog(id, { content: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Content is required',
    })
    expect(await storedContent(id)).toBe('The original body')
  })

  it('CHG-A-45 an edit to the title or body re-embeds the entry; other edits do not', async () => {
    const id = await seedEntry()
    vi.mocked(embedChangelogEntryOnPublish).mockClear()

    await updateChangelog(id, { featuredImageUrl: 'https://cdn.example.com/a.png' })
    expect(embedChangelogEntryOnPublish).not.toHaveBeenCalled()

    await updateChangelog(id, { content: 'An edited body' })
    expect(embedChangelogEntryOnPublish).toHaveBeenCalledWith(id)

    vi.mocked(embedChangelogEntryOnPublish).mockClear()
    await updateChangelog(id, { title: 'An edited title' })
    expect(embedChangelogEntryOnPublish).toHaveBeenCalledWith(id)
  })
})
