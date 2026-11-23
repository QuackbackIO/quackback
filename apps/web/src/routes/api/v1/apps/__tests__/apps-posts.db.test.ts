/**
 * Sidebar app reads and writes against the real schema.
 *
 * - Search fills in each post's status name and colour.
 * - Linking a ticket to a deleted or unknown post answers 404 and leaves no
 *   link row behind (the link used to be inserted before the post was checked).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, generateId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn().mockResolvedValue({ principalId: 'principal_test', role: 'admin' }),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postExternalLinks,
  postStatuses,
  posts,
  principal,
  user,
} from '@/lib/server/db'
import { Route as SearchRoute } from '../search'
import { Route as LinkRoute } from '../link'

type Handler = (ctx: { request: Request }) => Promise<Response>

function handlerOf(route: { options: unknown }, method: 'GET' | 'POST'): Handler {
  return (route.options as { server: { handlers: Record<string, Handler> } }).server.handlers[
    method
  ]
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postExternalLinks.id }).from(postExternalLinks).limit(0)
    await db.select({ id: posts.id, statusId: posts.statusId }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedPost(overrides: Partial<typeof posts.$inferInsert> = {}) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Author' })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `b-${suffix()}`, name: 'Board' })
    .returning()
  const [status] = await testDb
    .insert(postStatuses)
    .values({ name: 'Under review', slug: `s_${suffix()}`, color: '#abcdef' })
    .returning()
  const token = `zq${suffix()}`
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: `Dark mode ${token}`,
      content: '',
      principalId,
      statusId: status.id,
      ...overrides,
    })
    .returning()
  return { post, status, token }
}

function link(postId: string, externalId: string) {
  return handlerOf(
    LinkRoute,
    'POST'
  )({
    request: new Request('http://test/api/v1/apps/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postId,
        integrationType: 'helpdesk',
        externalId,
        requester: { email: `${externalId}@customers.example` },
      }),
    }),
  })
}

function linkRows(externalId: string) {
  return testDb
    .select({ id: postExternalLinks.id })
    .from(postExternalLinks)
    .where(eq(postExternalLinks.externalId, externalId))
}

describe.skipIf(!fixture.available)('sidebar apps', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("search fills in each post's status name and colour", async () => {
    const { post, status, token } = await seedPost()

    const res = await handlerOf(
      SearchRoute,
      'GET'
    )({
      request: new Request(`http://test/api/v1/apps/search?q=${token}`),
    })

    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { posts: Record<string, unknown>[] } }
    expect(data.posts).toEqual([
      expect.objectContaining({
        title: post.title,
        statusName: status.name,
        statusColor: '#abcdef',
      }),
    ])
  })

  it('linking a deleted post answers 404 and leaves no link', async () => {
    const { post } = await seedPost({ deletedAt: new Date() })
    const externalId = `T-${suffix()}`

    const res = await link(post.id, externalId)

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'Post not found'
    )
    expect(await linkRows(externalId)).toHaveLength(0)
  })

  it('linking an unknown post answers 404 and leaves no link', async () => {
    const externalId = `T-${suffix()}`

    const res = await link(generateId('post'), externalId)

    expect(res.status).toBe(404)
    expect(await linkRows(externalId)).toHaveLength(0)
  })
})
