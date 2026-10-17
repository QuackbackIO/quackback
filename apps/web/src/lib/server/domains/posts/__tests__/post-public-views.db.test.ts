import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, postSubscriptions, postVotes, principal, user } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async () => {
  const { getProductFlagUpdate } = await import('@/lib/shared/types/settings')
  return { getFeatureFlags: async () => getProductFlagUpdate('changelog', false) }
})
import { listPublicPosts } from '../post.public'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function person(type: 'user' | 'anonymous' = 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Kaye', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type, createdAt: new Date() })
  return principalId
}

function actorFor(principalId: PrincipalId, principalType: 'user' | 'anonymous' = 'user'): Actor {
  return { principalId, role: 'user', principalType, segmentIds: new Set() }
}

async function board(): Promise<BoardId> {
  const [row] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: `ideas-${createId('board').slice(-6)}` })
    .returning()
  return row!.id
}

async function idea(boardId: BoardId, author: PrincipalId, title: string): Promise<PostId> {
  const [row] = await testDb
    .insert(posts)
    .values({ boardId, principalId: author, title, content: 'x' })
    .returning()
  return row!.id
}

async function titles(params: Parameters<typeof listPublicPosts>[0]) {
  const { items } = await listPublicPosts({ ...params, limit: 100 })
  return items.map((p) => p.title).sort()
}

it('narrows the feed to the viewer’s own, voted and followed ideas', async () => {
  const me = await person()
  const other = await person()
  const boardId = await board()
  await idea(boardId, me, 'Mine')
  const voted = await idea(boardId, other, 'Voted')
  const followed = await idea(boardId, other, 'Followed')
  await idea(boardId, other, 'Unrelated')
  await testDb.insert(postVotes).values({ postId: voted, principalId: me })
  await testDb
    .insert(postSubscriptions)
    .values({ postId: followed, principalId: me, reason: 'manual' })

  const actor = actorFor(me)
  expect(await titles({ actor, view: 'mine' })).toEqual(['Mine'])
  expect(await titles({ actor, view: 'voted' })).toEqual(['Voted'])
  expect(await titles({ actor, view: 'following' })).toEqual(['Followed'])
})

it('ignores the view for an anonymous viewer, so a crafted URL shows the whole feed', async () => {
  const anon = await person('anonymous')
  const boardId = await board()
  await idea(boardId, anon, 'Theirs')
  const author = await person()
  await idea(boardId, author, 'Someone else')

  const all = await titles({ actor: actorFor(anon, 'anonymous') })
  expect(await titles({ actor: actorFor(anon, 'anonymous'), view: 'mine' })).toEqual(all)
  expect(all).toEqual(expect.arrayContaining(['Someone else', 'Theirs']))
})
