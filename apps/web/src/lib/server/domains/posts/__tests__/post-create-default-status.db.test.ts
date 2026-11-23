/**
 * A post created without a status (REST, MCP, Track as feedback) gets the
 * status marked default, like the portal and the admin dialog do, and only
 * falls back to the open slug when none is marked (FBA-P-04).
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostStatusId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, postStatuses, principal, sql, user } from '@/lib/server/db'
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

import { createPost } from '../post.service'

const fixture = await createDbTestFixture()
let admin: PrincipalId
let boardId: BoardId
let open: PostStatusId
let fresh: PostStatusId

const teamAuthor = () => ({
  principalId: admin,
  actor: { principalId: admin, principalType: 'user', role: 'admin' } as never,
})

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  admin = createId('principal')
  const adminUser = createId('user')
  await testDb.insert(user).values({ id: adminUser, name: 'Admin', email: 'admin@example.com' })
  await testDb
    .insert(principal)
    .values({ id: admin, userId: adminUser, type: 'user', role: 'admin', createdAt: new Date() })
  boardId = createId('board')
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  // Start from a known catalogue: only the statuses below are live. The old
  // rows also give up their slugs, so the open slug is free to insert.
  await testDb.update(postStatuses).set({
    deletedAt: new Date(),
    isDefault: false,
    slug: sql`${postStatuses.slug} || '-was-' || ${postStatuses.id}`,
  })
  open = createId('post_status')
  fresh = createId('post_status')
  await testDb.insert(postStatuses).values([
    { id: open, name: 'Open', slug: 'open' },
    { id: fresh, name: 'Fresh', slug: `fresh-${fresh}` },
  ])
})
afterEach(fixture.rollback)
afterAll(fixture.close)

// FBA-P-04
it('gives a post created without a status the workspace default, not the open slug', async () => {
  await testDb.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, fresh))
  const post = await createPost({ boardId, title: 'No status' }, teamAuthor(), {
    skipDispatch: true,
  })
  expect(post.statusId).toBe(fresh)
})

it('falls back to the open status when no status is marked default', async () => {
  const post = await createPost({ boardId, title: 'No status' }, teamAuthor(), {
    skipDispatch: true,
  })
  expect(post.statusId).toBe(open)
})
