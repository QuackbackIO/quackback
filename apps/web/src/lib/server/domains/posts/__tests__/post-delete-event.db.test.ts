/**
 * post.deleted names who deleted the post (`deletedBy`), whichever way the
 * delete arrived: the admin app passes the user id, REST and MCP pass only the
 * principal. The deleter is read from the principal, so every path carries it.
 *
 * Real Postgres in a rolled-back transaction; the event is caught where
 * dispatch hands it to processing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const processed = vi.hoisted(() => [] as EventData[])
vi.mock('@/lib/server/events/process', () => ({
  processEvent: async (event: EventData) => {
    processed.push(event)
  },
}))

const { softDeletePost } = await import('../post.user-actions')

const fixture = await createDbTestFixture()
const tag = Math.random().toString(36).slice(2, 8)

async function seedPost(): Promise<PostId> {
  const boardId = createId('board') as BoardId
  await testDb.insert(boards).values({ id: boardId, name: `Board ${tag}`, slug: `del-${tag}` })
  const postId = createId('post') as PostId
  const author = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: author, role: 'user', type: 'anonymous', createdAt: new Date() })
  await testDb
    .insert(posts)
    .values({ id: postId, boardId, title: `Deleted ${tag}`, content: '', principalId: author })
  return postId
}

async function deletedEvent(postId: PostId) {
  await vi.waitFor(() => {
    expect(processed.some((e) => e.type === 'post.deleted')).toBe(true)
  })
  const event = processed.find((e) => e.type === 'post.deleted')!
  expect(event.data).toMatchObject({ post: { id: postId } })
  return event as Extract<EventData, { type: 'post.deleted' }>
}

describe.skipIf(!fixture.available)('post.deleted says who deleted the post (real DB)', () => {
  let adminUser: UserId
  let admin: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    processed.length = 0
    adminUser = createId('user') as UserId
    admin = createId('principal') as PrincipalId
    await testDb
      .insert(user)
      .values({ id: adminUser, name: `Ada Admin ${tag}`, email: `ada-${tag}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: admin, userId: adminUser, role: 'admin', type: 'user', createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('names the teammate who deleted it from the admin app', async () => {
    const postId = await seedPost()
    await softDeletePost(postId, { principalId: admin, role: 'admin', userId: adminUser })
    const event = await deletedEvent(postId)
    expect(event.data.deletedBy).toBe(`ada-${tag}@example.com`)
    expect(event.actor).toMatchObject({ type: 'user', principalId: admin, userId: adminUser })
  })

  it('names the teammate when the caller passes only the principal (REST, MCP)', async () => {
    const postId = await seedPost()
    await softDeletePost(postId, { principalId: admin, role: 'admin' })
    const event = await deletedEvent(postId)
    expect(event.data.deletedBy).toBe(`ada-${tag}@example.com`)
  })

  it('names an API key by its own name', async () => {
    const key = createId('principal') as PrincipalId
    await testDb.insert(principal).values({
      id: key,
      role: 'admin',
      type: 'service',
      displayName: `Automation key ${tag}`,
      createdAt: new Date(),
    })
    const postId = await seedPost()
    await softDeletePost(postId, { principalId: key, role: 'admin' })
    const event = await deletedEvent(postId)
    expect(event.data.deletedBy).toBe(`Automation key ${tag}`)
    expect(event.actor).toMatchObject({ type: 'service', principalId: key })
  })
})
