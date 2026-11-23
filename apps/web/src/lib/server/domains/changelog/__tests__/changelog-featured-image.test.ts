/**
 * CHG-A-26: featured image semantics. On update, undefined leaves the image,
 * null clears it and a string replaces it; the shared schemas cap it at 2048
 * characters for both create and update.
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
import { createChangelog, updateChangelog } from '../changelog.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: changelogEntries.id, image: changelogEntries.featuredImageUrl })
      .from(changelogEntries)
      .limit(0)
  },
})

const HERO = 'https://cdn.example.com/hero.png'
const NEW_HERO = 'https://cdn.example.com/hero-2.png'

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

async function storedImage(id: ChangelogId): Promise<string | null> {
  const [row] = await testDb
    .select({ image: changelogEntries.featuredImageUrl })
    .from(changelogEntries)
    .where(eq(changelogEntries.id, id))
  return row.image
}

describe.skipIf(!fixture.available)('changelog featured image (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('CHG-A-26 create stores the image, and null or omitted stores none', async () => {
    const author = await seedAuthor()
    const draft = { type: 'draft' as const }

    const withImage = await createChangelog(
      { title: 'A', content: 'Body', publishState: draft, featuredImageUrl: HERO },
      author
    )
    const withNull = await createChangelog(
      { title: 'B', content: 'Body', publishState: draft, featuredImageUrl: null },
      author
    )
    const omitted = await createChangelog(
      { title: 'C', content: 'Body', publishState: draft },
      author
    )

    expect(await storedImage(withImage.id)).toBe(HERO)
    expect(await storedImage(withNull.id)).toBeNull()
    expect(await storedImage(omitted.id)).toBeNull()
  })

  it('CHG-A-26 update: undefined leaves the image, a string replaces it, null clears it', async () => {
    const author = await seedAuthor()
    const entry = await createChangelog(
      { title: 'A', content: 'Body', publishState: { type: 'draft' }, featuredImageUrl: HERO },
      author
    )

    await updateChangelog(entry.id, { title: 'Renamed' })
    expect(await storedImage(entry.id)).toBe(HERO)

    await updateChangelog(entry.id, { featuredImageUrl: NEW_HERO })
    expect(await storedImage(entry.id)).toBe(NEW_HERO)

    await updateChangelog(entry.id, { featuredImageUrl: null })
    expect(await storedImage(entry.id)).toBeNull()
  })
})

describe('CHG-A-26 featured image length cap', () => {
  const base = { title: 'A', content: 'Body', publishState: { type: 'draft' } }
  const atCap = `https://cdn.example.com/${'a'.repeat(2048 - 'https://cdn.example.com/'.length)}`

  it('CHG-A-26 accepts 2048 characters and refuses 2049 on create and update', () => {
    expect(atCap).toHaveLength(2048)
    expect(createChangelogSchema.safeParse({ ...base, featuredImageUrl: atCap }).success).toBe(true)
    expect(
      createChangelogSchema.safeParse({ ...base, featuredImageUrl: `${atCap}a` }).success
    ).toBe(false)
    expect(updateChangelogSchema.safeParse({ id: 'x', featuredImageUrl: atCap }).success).toBe(true)
    expect(
      updateChangelogSchema.safeParse({ id: 'x', featuredImageUrl: `${atCap}a` }).success
    ).toBe(false)
    expect(updateChangelogSchema.safeParse({ id: 'x', featuredImageUrl: null }).success).toBe(true)
  })
})
