import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversations,
  helpCenterArticles,
  helpCenterCategories,
  posts,
  principal,
  settings,
  statusComponents,
  user,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: async (options?: { permission?: string }) => {
    expect(options?.permission).toBe(PERMISSIONS.MEMBER_VIEW)
    return { user: { id: 'user_caller' } }
  },
}))
vi.mock('../workspace', async () => ({
  getSettings: async () =>
    (await (
      await import('@/lib/server/__tests__/db-test-fixture')
    ).testDb.query.settings.findFirst()) ?? null,
}))

const { getTourContextFn } = await import('../onboarding-progress')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusComponents.id }).from(statusComponents).limit(0)
  },
})

async function author(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

describe('the tour context', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    await testDb.delete(conversations)
    await testDb.delete(posts)
    await testDb.delete(helpCenterArticles)
    await testDb.delete(statusComponents)
    await testDb.delete(settings)
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        goals: ['customer_support', 'product_feedback'],
        feedbackPrivate: true,
      }),
    })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('reports the goals and every product as empty in a new workspace', async () => {
    expect(await getTourContextFn()).toEqual({
      goals: ['customer_support', 'product_feedback'],
      feedbackPrivate: true,
      empty: { feedback: true, support: true, helpCenter: true, status: true },
    })
  })

  it('counts only content that is not deleted', async () => {
    const principalId = await author()
    const boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, slug: 'tour-board', name: 'Acme' })
    await testDb.insert(posts).values({
      boardId,
      title: 'Acme idea',
      content: 'Acme',
      principalId,
      deletedAt: new Date(),
    })
    await testDb.insert(statusComponents).values({ name: 'Acme API', deletedAt: new Date() })
    expect((await getTourContextFn()).empty).toEqual({
      feedback: true,
      support: true,
      helpCenter: true,
      status: true,
    })

    await testDb.insert(posts).values({ boardId, title: 'Acme idea', content: 'Acme', principalId })
    await testDb.insert(statusComponents).values({ name: 'Acme API' })
    await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
    const [category] = await testDb
      .insert(helpCenterCategories)
      .values({ name: 'Acme', slug: 'acme-tour' })
      .returning()
    await testDb.insert(helpCenterArticles).values({
      categoryId: category!.id,
      slug: 'acme-tour',
      title: 'Acme',
      content: 'Acme',
      principalId,
    })
    expect((await getTourContextFn()).empty).toEqual({
      feedback: false,
      support: false,
      helpCenter: false,
      status: false,
    })
  })
})
