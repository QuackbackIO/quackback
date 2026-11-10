/**
 * The item picker offers only what a signed-out visitor can open: a post on
 * a board that signed-in visitors, a segment or the team alone may see is
 * never among them, nor a deleted one.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async () => {
  const { getProductFlagUpdate } = await import('@/lib/shared/types/settings')
  return { getFeatureFlags: async () => getProductFlagUpdate('changelog', false) }
})
import { listDesignerPosts } from '../designer-posts'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function author(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Kaye', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

async function board(view: 'anonymous' | 'authenticated' | 'team'): Promise<BoardId> {
  const [row] = await testDb
    .insert(boards)
    .values({
      name: view,
      slug: `${view}-${createId('board').slice(-6)}`,
      access: { ...DEFAULT_BOARD_ACCESS, view, vote: view, comment: view, submit: view },
    })
    .returning()
  return row!.id
}

it('lists posts on public boards only, each at its own address', async () => {
  const by = await author()
  const open = await board('anonymous')
  const signedIn = await board('authenticated')
  const team = await board('team')
  const [shown] = await testDb
    .insert(posts)
    .values({ boardId: open, principalId: by, title: 'Public idea', content: 'x', voteCount: 1 })
    .returning()
  await testDb.insert(posts).values([
    { boardId: signedIn, principalId: by, title: 'Members idea', content: 'x', voteCount: 50 },
    { boardId: team, principalId: by, title: 'Team idea', content: 'x', voteCount: 90 },
    {
      boardId: open,
      principalId: by,
      title: 'Deleted idea',
      content: 'x',
      voteCount: 70,
      deletedAt: new Date(),
    },
  ])

  const listed = await listDesignerPosts()
  expect(listed.map((post) => post.title)).toEqual(['Public idea'])
  expect(listed[0]!.path).toMatch(new RegExp(`^/b/[^/]+/posts/${shown!.id}$`))
})
