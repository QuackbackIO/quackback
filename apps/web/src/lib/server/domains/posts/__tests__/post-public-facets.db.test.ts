import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostId,
  type PostStatusId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  posts,
  postStatuses,
  postTagAssignments,
  postTags,
  postVotes,
  principal,
  user,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { countPublicPostFacets } from '../post.public.facets'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function person(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Kaye', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

const viewerOf = (principalId: PrincipalId): Actor => ({
  principalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
})

async function board(slug: string, access?: 'team'): Promise<BoardId> {
  const [row] = await testDb
    .insert(boards)
    .values({
      name: slug,
      slug: `${slug}-${createId('board').slice(-6)}`,
      ...(access && {
        access: {
          view: 'team',
          vote: 'team',
          comment: 'team',
          submit: 'team',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
      }),
    })
    .returning()
  return row!.id
}

async function status(slug: string): Promise<PostStatusId> {
  const [row] = await testDb.select().from(postStatuses).where(eq(postStatuses.slug, slug))
  return row!.id
}

/** A word only this test's posts contain, so counts ignore other data in the database. */
const token = `facet${Math.random()
  .toString(36)
  .replace(/[^a-z]/g, '')
  .slice(0, 8)}`

async function idea(
  boardId: BoardId,
  author: PrincipalId,
  statusId: PostStatusId | null = null
): Promise<PostId> {
  const [row] = await testDb
    .insert(posts)
    .values({ boardId, principalId: author, title: `Idea ${token}`, content: 'x', statusId })
    .returning()
  return row!.id
}

it('counts every status, board and view, each ignoring its own filter', async () => {
  const me = await person()
  const other = await person()
  const ideas = await board('ideas')
  const bugs = await board('bugs')
  const open = await status('open')
  const complete = await status('complete')
  await idea(ideas, me, open)
  const voted = await idea(ideas, other, complete)
  await idea(bugs, other, open)
  await testDb.insert(postVotes).values({ postId: voted, principalId: me })

  const counts = await countPublicPostFacets(
    { search: token, statusSlugs: ['open'], portalFeed: true },
    viewerOf(me)
  )

  // Status counts ignore the status filter, so complete still shows.
  expect(counts.statuses.open).toBe(2)
  expect(counts.statuses.complete).toBe(1)
  // Board and view counts respect it (open only).
  const ideasSlug = Object.keys(counts.boards).find((s) => s.startsWith('ideas-'))!
  const bugsSlug = Object.keys(counts.boards).find((s) => s.startsWith('bugs-'))!
  expect(counts.boards[ideasSlug]).toBe(1)
  expect(counts.boards[bugsSlug]).toBe(1)
  expect(counts.views).toEqual({ mine: 1, voted: 0, following: 0 })
  expect(counts.total).toBe(2)
})

async function slugOf(boardId: BoardId): Promise<string> {
  const [row] = await testDb.select().from(boards).where(eq(boards.id, boardId))
  return row!.slug
}

it('counts a view over every status, as the view shows it', async () => {
  const me = await person()
  const ideas = await board('ideas')
  await idea(ideas, me, await status('open'))
  await idea(ideas, me, await status('complete'))
  const params = { boardSlug: await slugOf(ideas), portalFeed: true }

  const counts = await countPublicPostFacets(params, viewerOf(me))
  expect(counts.views?.mine).toBe(2)
  // The default feed is active only.
  expect(counts.total).toBe(1)

  const inView = await countPublicPostFacets({ ...params, view: 'mine' }, viewerOf(me))
  expect(inView.total).toBe(2)
  expect(inView.boards[params.boardSlug]).toBe(2)
})

it('counts tags with the other filters applied, and never a tag the viewer cannot see', async () => {
  const me = await person()
  const ideas = await board('ideas')
  const open = await status('open')
  const complete = await status('complete')
  const [shown, internal] = await testDb
    .insert(postTags)
    .values([
      { name: `shown-${token}`, color: '#84cc16' },
      { name: `internal-${token}`, color: '#84cc16', isPublic: false },
    ])
    .returning()
  const a = await idea(ideas, me, open)
  const b = await idea(ideas, me, complete)
  await testDb.insert(postTagAssignments).values([
    { postId: a, tagId: shown!.id },
    { postId: b, tagId: shown!.id },
    { postId: a, tagId: internal!.id },
  ])

  const counts = await countPublicPostFacets(
    { boardSlug: await slugOf(ideas), tagIds: [shown!.id], portalFeed: true },
    viewerOf(me)
  )
  // Active only by default, so the complete idea is not counted.
  expect(counts.tags[shown!.id]).toBe(1)
  expect(counts.tags[internal!.id]).toBeUndefined()
})

it('never counts posts on a board the viewer cannot see', async () => {
  const me = await person()
  const hidden = await board('team', 'team')
  await idea(hidden, me, await status('open'))

  const counts = await countPublicPostFacets({ search: token, portalFeed: true }, viewerOf(me))

  expect(Object.keys(counts.boards).some((s) => s.startsWith('team-'))).toBe(false)
  expect(counts.views?.mine).toBe(0)
})

it('gives anonymous viewers no view counts', async () => {
  const counts = await countPublicPostFacets(
    {},
    { principalId: null, role: null, principalType: 'anonymous', segmentIds: new Set() }
  )
  expect(counts.views).toBeNull()
})
