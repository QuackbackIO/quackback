/**
 * A merge resolves the pending merge suggestions that name the merged post
 * (FBA-M-12): after a manual merge none of them may stay pending, and
 * accepting a suggestion still leaves that suggestion accepted.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostMergeSuggestionId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, mergeSuggestions, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostMerged: vi.fn(),
  dispatchPostUnmerged: vi.fn(),
  buildEventActor: vi.fn((actor) => actor),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

import { mergePost } from '../post.merge'
import { acceptMergeSuggestion } from '../../merge-suggestions/merge-suggestion.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: mergeSuggestions.id }).from(mergeSuggestions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name })
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
    .values({ slug: `msug-${suffix()}`, name: 'Merge board', access: DEFAULT_BOARD_ACCESS })
    .returning()
  return board.id
}

async function seedPost(boardId: BoardId, principalId: PrincipalId, title: string) {
  const [post] = await testDb
    .insert(posts)
    .values({ boardId, title, content: '', principalId })
    .returning()
  return post.id as PostId
}

async function seedSuggestion(source: PostId, target: PostId): Promise<PostMergeSuggestionId> {
  const [row] = await testDb
    .insert(mergeSuggestions)
    .values({
      sourcePostId: source,
      targetPostId: target,
      status: 'pending',
      vectorScore: 0.9,
      ftsScore: 0.9,
      hybridScore: 0.9,
      llmConfidence: 0.9,
    })
    .returning()
  return row.id as PostMergeSuggestionId
}

async function statusOf(id: PostMergeSuggestionId) {
  const [row] = await testDb.select().from(mergeSuggestions).where(eq(mergeSuggestions.id, id))
  return row?.status
}

describe.skipIf(!fixture.available)('merging resolves pending merge suggestions (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a manual merge dismisses every pending suggestion naming the merged post', async () => {
    const author = await seedPrincipal('Author')
    const actor = await seedPrincipal('Actor')
    const boardId = await seedBoard()
    const dup = await seedPost(boardId, author, 'D')
    const can = await seedPost(boardId, author, 'C')
    const other = await seedPost(boardId, author, 'E')
    const unrelated = await seedPost(boardId, author, 'F')
    const dc = await seedSuggestion(dup, can)
    const ed = await seedSuggestion(other, dup)
    const de = await seedSuggestion(dup, other)
    const ef = await seedSuggestion(other, unrelated)

    await mergePost(dup, can, actor)

    expect(await statusOf(dc)).toBe('dismissed')
    expect(await statusOf(ed)).toBe('dismissed')
    expect(await statusOf(de)).toBe('dismissed')
    expect(await statusOf(ef)).toBe('pending')
  })

  it('accepting a suggestion still marks it accepted', async () => {
    const author = await seedPrincipal('Author')
    const actor = await seedPrincipal('Actor')
    const boardId = await seedBoard()
    const dup = await seedPost(boardId, author, 'D')
    const can = await seedPost(boardId, author, 'C')
    const id = await seedSuggestion(dup, can)

    await acceptMergeSuggestion(id, actor)

    const [row] = await testDb.select().from(mergeSuggestions).where(eq(mergeSuggestions.id, id))
    expect(row.status).toBe('accepted')
    expect(row.resolvedByPrincipalId).toBe(actor)
  })
})
