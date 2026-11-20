/**
 * Real-DB coverage for an entry's linked posts: how the admin link list is
 * written (CHG-A-23) and which linked posts the public entry shows (CHG-P-08).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ChangelogId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'

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
import {
  boards,
  changelogEntries,
  changelogEntryPosts,
  eq,
  posts,
  principal,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'
import { createChangelog, updateChangelog } from '../changelog.service'
import { getPublicChangelogById } from '../changelog.public'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogEntryPosts.changelogEntryId }).from(changelogEntryPosts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const DRAFT = { type: 'draft' as const }

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Changelog author' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: 'Changelog author',
    createdAt: new Date(),
  })
  return principalId
}

async function seedBoard(
  access: Partial<BoardAccess> = {},
  extra: { deletedAt?: Date } = {}
): Promise<BoardId> {
  const [board] = await testDb
    .insert(boards)
    .values({
      slug: `changelog-links-${suffix()}`,
      name: 'Board',
      access: { ...DEFAULT_BOARD_ACCESS, ...access },
      ...extra,
    })
    .returning()
  return board.id
}

async function seedPost(
  boardId: BoardId,
  principalId: PrincipalId,
  overrides: Partial<typeof posts.$inferInsert> = {}
): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({ boardId, principalId, title: `Linked ${suffix()}`, content: '', ...overrides })
    .returning()
  return post.id
}

async function linkedIds(entryId: ChangelogId): Promise<PostId[]> {
  const rows = await testDb
    .select({ postId: changelogEntryPosts.postId })
    .from(changelogEntryPosts)
    .where(eq(changelogEntryPosts.changelogEntryId, entryId))
  return rows.map((row) => row.postId).sort()
}

describe.skipIf(!fixture.available)('changelog linked posts (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('CHG-A-23 writing the link list', () => {
    it('CHG-A-23 drops unknown post ids on create and on update', async () => {
      const author = await seedPrincipal()
      const board = await seedBoard()
      const first = await seedPost(board, author)
      const second = await seedPost(board, author)
      const unknown = createId('post') as PostId

      const entry = await createChangelog(
        { title: 'Links', content: 'Body', publishState: DRAFT, linkedPostIds: [first, unknown] },
        { principalId: author, name: 'Author' }
      )
      expect(await linkedIds(entry.id)).toEqual([first])

      await updateChangelog(entry.id, { linkedPostIds: [unknown, second] })
      expect(await linkedIds(entry.id)).toEqual([second])
    })

    // Root cause: linkPostsToChangelog does not de-duplicate postIds
    // (apps/web/src/lib/server/domains/changelog/changelog.service.ts:569), so
    // the insert hits changelog_entry_posts_pk; updateChangelog has already
    // deleted the old links outside any transaction (changelog.service.ts:252),
    // so outside this rolled-back fixture the entry is left with no links.
    // See apps/web/e2e/QUARANTINE.md.
    it.fails(
      'CHG-A-23 a duplicate post id in an update is saved once (quarantined: duplicate linkedPostIds fail the insert after the old links were deleted)',
      async () => {
        const author = await seedPrincipal()
        const board = await seedBoard()
        const first = await seedPost(board, author)
        const second = await seedPost(board, author)
        const entry = await createChangelog(
          { title: 'Links', content: 'Body', publishState: DRAFT, linkedPostIds: [first] },
          { principalId: author, name: 'Author' }
        )

        await updateChangelog(entry.id, { linkedPostIds: [second, second] })

        expect(await linkedIds(entry.id)).toEqual([second])
      }
    )

    // Root cause: same as above on the create path
    // (apps/web/src/lib/server/domains/changelog/changelog.service.ts:135): the
    // entry row is inserted, then the duplicate link insert throws, leaving an
    // entry without its links or categories. See apps/web/e2e/QUARANTINE.md.
    it.fails(
      'CHG-A-23 a duplicate post id on create is saved once (quarantined: duplicate linkedPostIds fail the insert after the entry was written)',
      async () => {
        const author = await seedPrincipal()
        const board = await seedBoard()
        const first = await seedPost(board, author)

        const entry = await createChangelog(
          { title: 'Links', content: 'Body', publishState: DRAFT, linkedPostIds: [first, first] },
          { principalId: author, name: 'Author' }
        )

        expect(await linkedIds(entry.id)).toEqual([first])
      }
    )
  })

  describe('CHG-P-08 linked posts on the public entry', () => {
    it('CHG-P-08 lists only published, live posts on live anonymous boards that are not by a test customer', async () => {
      const author = await seedPrincipal()
      const testCustomer = createId('principal') as PrincipalId
      await testDb.insert(principal).values({
        id: testCustomer,
        role: 'user',
        type: 'anonymous',
        testOwnerPrincipalId: author,
        createdAt: new Date(),
      })
      const publicBoard = await seedBoard()
      const teamBoard = await seedBoard({ view: 'team' })
      const segmentBoard = await seedBoard({
        view: 'segments',
        segments: { view: ['segment_x'], vote: [], comment: [], submit: [] },
      })
      const deletedBoard = await seedBoard({}, { deletedAt: new Date() })

      const visible = await seedPost(publicBoard, author)
      const hidden = [
        await seedPost(publicBoard, author, { moderationState: 'pending' }),
        await seedPost(publicBoard, author, { moderationState: 'spam' }),
        await seedPost(publicBoard, author, { moderationState: 'archived' }),
        await seedPost(publicBoard, author, { deletedAt: new Date() }),
        await seedPost(teamBoard, author),
        await seedPost(segmentBoard, author),
        await seedPost(deletedBoard, author),
        await seedPost(publicBoard, testCustomer),
      ]

      const [entry] = await testDb
        .insert(changelogEntries)
        .values({
          title: 'Shipped',
          content: 'Body',
          publishedAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning()
      await testDb
        .insert(changelogEntryPosts)
        .values([visible, ...hidden].map((postId) => ({ changelogEntryId: entry.id, postId })))

      const result = await getPublicChangelogById(entry.id)

      expect(result.linkedPosts.map((post) => post.id)).toEqual([visible])
    })
  })
})
