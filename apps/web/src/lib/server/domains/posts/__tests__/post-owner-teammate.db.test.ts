/**
 * A post's owner must be a teammate (FBA-P-11): a customer, or an id naming
 * nobody, is refused before anything is written. Clearing the owner works.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'

const dispatchPostStatusChanged = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostStatusChanged,
  dispatchPostUpdated: vi.fn(),
  dispatchPostOwnerAssigned: vi.fn(),
  dispatchPostVoted: vi.fn(),
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity: vi.fn() }))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown) => json,
}))
vi.mock('@/lib/server/domains/posts/post.autotag', () => ({ autoTagPost: async () => [] }))
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generatePostEmbedding: async () => undefined,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getPortalConfig: async () => DEFAULT_PORTAL_CONFIG,
}))

import { updatePost } from '../post.service'

const fixture = await createDbTestFixture()
let admin: PrincipalId
let postId: PostId

async function seedPrincipal(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const id = createId('principal')
  const userId = createId('user')
  await testDb.insert(user).values({ id: userId, name: `P ${role}`, email: `${id}@example.com` })
  await testDb.insert(principal).values({ id, userId, type: 'user', role, createdAt: new Date() })
  return id
}

async function ownerOf(id: PostId) {
  const [row] = await testDb
    .select({ owner: posts.ownerPrincipalId })
    .from(posts)
    .where(eq(posts.id, id))
  return row.owner
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  admin = await seedPrincipal('admin')
  const boardId: BoardId = createId('board')
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  postId = createId('post')
  await testDb
    .insert(posts)
    .values({ id: postId, boardId, title: 'An idea', content: '', principalId: admin })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

// FBA-P-11
it('refuses a customer as the post owner and leaves the post unowned', async () => {
  const customer = await seedPrincipal('user')
  await expect(
    updatePost(postId, { ownerPrincipalId: customer }, { principalId: admin })
  ).rejects.toMatchObject({ code: 'INVALID_OWNER' })
  expect(await ownerOf(postId)).toBeNull()
})

it('refuses an owner id that names nobody', async () => {
  await expect(
    updatePost(postId, { ownerPrincipalId: createId('principal') }, { principalId: admin })
  ).rejects.toMatchObject({ code: 'INVALID_OWNER' })
})

it('assigns a teammate and clears the owner again', async () => {
  const member = await seedPrincipal('member')
  await updatePost(postId, { ownerPrincipalId: member }, { principalId: admin })
  expect(await ownerOf(postId)).toBe(member)
  await updatePost(postId, { ownerPrincipalId: null }, { principalId: admin })
  expect(await ownerOf(postId)).toBeNull()
})
