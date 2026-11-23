/**
 * Real-DB coverage for inbox predicates whose correctness depends on how
 * Drizzle renders correlated subqueries.
 *
 * - The Team response counts select a correlated EXISTS. Drizzle renders
 *   columns in a single-table select list without their table prefix, so an
 *   outer `posts.id` written as a Drizzle column binds to `post_comments.id`
 *   inside the subquery and every post counts as unresponded.
 * - The list reads through the relational query builder, which rewrites every
 *   column object in a raw `sql` fragment onto the posts alias, so the author
 *   email EXISTS must name the principal and user columns raw.
 *
 * Only real SQL shows either, so this suite runs against Postgres.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { countInboxFilterFacets, listInboxPosts } from '../post.inbox'
import { listBoardsWithDetails } from '../../boards/board.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, canonicalPostId: posts.canonicalPostId }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(name: string, email?: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, ...(email && { email }) })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

async function seedBoard(): Promise<BoardId> {
  const [board] = await testDb
    .insert(boards)
    .values({
      slug: `responded-${suffix()}`,
      name: 'Responded board',
      access: DEFAULT_BOARD_ACCESS,
    })
    .returning()
  return board.id
}

async function seedPost(boardId: BoardId, author: PrincipalId, title: string): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({ boardId, title, content: '', principalId: author })
    .returning()
  return post.id
}

async function seedComment(postId: PostId, author: PrincipalId, isTeamMember: boolean) {
  await testDb
    .insert(postComments)
    .values({ postId, principalId: author, content: 'comment', isTeamMember })
}

describe.skipIf(!fixture.available)('inbox correlated predicates (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts posts with a team comment as responded, matching the filtered list', async () => {
    const author = await seedPrincipal('Author')
    const boardId = await seedBoard()
    const answered = await seedPost(boardId, author, 'Answered')
    const userOnly = await seedPost(boardId, author, 'User comment only')
    await seedPost(boardId, author, 'Silent')
    await seedComment(answered, author, true)
    await seedComment(userOnly, author, false)

    const counts = await countInboxFilterFacets({ boardIds: [boardId], responded: 'responded' })
    expect(counts.responded).toEqual({ responded: 1, unresponded: 2 })

    const list = await listInboxPosts({ boardIds: [boardId], responded: 'responded' })
    expect(list.items.map((p) => p.title)).toEqual(['Answered'])
  })

  it('filters the list by author email, case-insensitively', async () => {
    const email = `ada-${suffix()}@acme.test`
    const ada = await seedPrincipal('Ada', email)
    const other = await seedPrincipal('Other', `other-${suffix()}@acme.test`)
    const boardId = await seedBoard()
    await seedPost(boardId, ada, 'By Ada')
    await seedPost(boardId, other, 'By someone else')

    const list = await listInboxPosts({ authorEmail: email.toUpperCase() })

    expect(list.items.map((p) => p.title)).toEqual(['By Ada'])
  })

  // FBA-I-22
  it('leaves a merged duplicate out of the list, the facet counts and the board count until unmerged', async () => {
    const author = await seedPrincipal('Author')
    const boardId = await seedBoard()
    const canonical = await seedPost(boardId, author, 'Canonical')
    const duplicate = await seedPost(boardId, author, 'Duplicate')
    await testDb
      .update(posts)
      .set({ canonicalPostId: canonical, mergedAt: new Date() })
      .where(eq(posts.id, duplicate))

    const titles = async () =>
      (await listInboxPosts({ boardIds: [boardId] })).items.map((p) => p.title).sort()
    const boardCount = async () =>
      (await listBoardsWithDetails()).find((b) => b.id === boardId)?.postCount
    expect(await titles()).toEqual(['Canonical'])
    expect((await countInboxFilterFacets({ boardIds: [boardId] })).boards[boardId]).toBe(1)
    expect(await boardCount()).toBe(1)

    await testDb
      .update(posts)
      .set({ canonicalPostId: null, mergedAt: null })
      .where(eq(posts.id, duplicate))
    expect(await titles()).toEqual(['Canonical', 'Duplicate'])
    expect((await countInboxFilterFacets({ boardIds: [boardId] })).boards[boardId]).toBe(2)
    expect(await boardCount()).toBe(2)
  })

  // FBA-I-29
  it('counts each facet over every other active filter but not its own', async () => {
    const author = await seedPrincipal('Author')
    const boardA = await seedBoard()
    const boardB = await seedBoard()
    const answeredA = await seedPost(boardA, author, 'Answered on A')
    await seedPost(boardA, author, 'Silent on A')
    const answeredB = await seedPost(boardB, author, 'Answered on B')
    const goneA = await seedPost(boardA, author, 'Deleted answered on A')
    const goneB = await seedPost(boardB, author, 'Deleted answered on B')
    for (const id of [answeredA, answeredB, goneA, goneB]) await seedComment(id, author, true)
    await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, goneA))
    await testDb.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, goneB))

    const counts = await countInboxFilterFacets({ boardIds: [boardA], responded: 'responded' })
    // Board counts ignore the board filter but keep "responded".
    expect(counts.boards[boardA]).toBe(1)
    expect(counts.boards[boardB]).toBe(1)
    // Responded counts ignore their own filter but keep the board.
    expect(counts.responded).toEqual({ responded: 1, unresponded: 1 })
    // Deleted counts keep both: only the restorable answered post on board A.
    expect(counts.deleted).toBe(1)
  })

  // FBA-I-31
  it('updatedBefore keeps only posts not updated since the date', async () => {
    const author = await seedPrincipal('Author')
    const boardId = await seedBoard()
    const stale = await seedPost(boardId, author, 'Stale')
    await seedPost(boardId, author, 'Fresh')
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await testDb.update(posts).set({ updatedAt: tenDaysAgo }).where(eq(posts.id, stale))

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const list = await listInboxPosts({ boardIds: [boardId], updatedBefore: fiveDaysAgo })
    expect(list.items.map((p) => p.title)).toEqual(['Stale'])
  })
})
