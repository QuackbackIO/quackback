import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'

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

async function author(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Kaye', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return principalId
}

type Kind = 'public' | 'team' | 'deleted'

/** A board with one idea on it, titled after the board. */
async function boardWithIdea(name: string, by: PrincipalId, kind: Kind = 'public') {
  const [row] = await testDb
    .insert(boards)
    .values({
      name,
      slug: `${name.toLowerCase()}-${createId('board').slice(-6)}`,
      access: kind === 'team' ? { ...DEFAULT_BOARD_ACCESS, view: 'team' } : DEFAULT_BOARD_ACCESS,
      deletedAt: kind === 'deleted' ? new Date() : null,
    })
    .returning()
  await testDb
    .insert(posts)
    .values({ boardId: row!.id, principalId: by, title: name, content: 'x', voteCount: 1 })
  return row!.id as BoardId
}

const teamActor = (principalId: PrincipalId): Actor => ({
  principalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
})

async function titles(boardIds: BoardId[] | undefined, actor: Actor = ANONYMOUS_ACTOR) {
  const { items } = await listPublicPosts({ boardIds, actor, limit: 50 })
  return items.map((p) => p.title).sort()
}

it('shows every board when none is chosen', async () => {
  const by = await author()
  await boardWithIdea('Mobile', by)
  await boardWithIdea('Sharing', by)
  expect(await titles(undefined)).toEqual(expect.arrayContaining(['Mobile', 'Sharing']))
  expect(await titles([])).toEqual(expect.arrayContaining(['Mobile', 'Sharing']))
})

it('shows only the chosen boards', async () => {
  const by = await author()
  const mobile = await boardWithIdea('Mobile', by)
  await boardWithIdea('Sharing', by)
  const billing = await boardWithIdea('Billing', by)
  expect(await titles([mobile, billing])).toEqual(['Billing', 'Mobile'])
})

it('ignores a chosen board that is private or gone, even for the team', async () => {
  const by = await author()
  const mobile = await boardWithIdea('Mobile', by)
  const secret = await boardWithIdea('Secret', by, 'team')
  const gone = await boardWithIdea('Gone', by, 'deleted')
  await boardWithIdea('Sharing', by)
  expect(await titles([mobile, secret, gone])).toEqual(['Mobile'])
  expect(await titles([mobile, secret], teamActor(by))).toEqual(['Mobile'])
})

it('falls back to every board when none of the chosen boards remains', async () => {
  const by = await author()
  const secret = await boardWithIdea('Secret', by, 'team')
  const gone = await boardWithIdea('Gone', by, 'deleted')
  await boardWithIdea('Sharing', by)
  const unknown = createId('board') as BoardId
  const shown = await titles([secret, gone, unknown])
  expect(shown).toContain('Sharing')
  expect(shown).not.toContain('Gone')
  expect(shown).not.toContain('Secret')
})

it('stops at the count asked for', async () => {
  const by = await author()
  const mobile = await boardWithIdea('Mobile', by)
  for (const n of [1, 2, 3])
    await testDb
      .insert(posts)
      .values({ boardId: mobile, principalId: by, title: `Extra ${n}`, content: 'x' })
  const { items } = await listPublicPosts({ boardIds: [mobile], actor: ANONYMOUS_ACTOR, limit: 3 })
  expect(items).toHaveLength(3)
})
