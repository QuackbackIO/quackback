import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import {
  boards,
  conversationMessages,
  conversations,
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
  posts,
  principal,
  statusComponents,
  statusSubscriptions,
  user,
  type SetupState,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { detectFirstWin } from '../activation-wins'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusComponents.id }).from(statusComponents).limit(0)
  },
})
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

/** A person with a portal or team role; `test` makes them a test customer of `owner`. */
async function person(
  role: 'user' | 'admin' | 'member',
  options: { type?: 'user' | 'anonymous'; testOwner?: PrincipalId; createdAt?: Date } = {}
): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: options.type ?? 'user',
    testOwnerPrincipalId: options.testOwner ?? null,
    createdAt: options.createdAt ?? new Date(),
  })
  return principalId
}

const goalState = (goal: SetupState['useCase']): SetupState => ({
  version: 2,
  steps: { core: true, workspace: true, startingPoint: null },
  useCase: goal,
  goals: [goal!],
})

it('never counts a service the team added as the status win, only an outside subscriber', async () => {
  const state = goalState('status_page')
  await testDb.insert(statusComponents).values({ name: 'Acme', createdAt: new Date('2026-01-01') })
  const owner = await person('admin')
  const tester = await person('user', { testOwner: owner })
  const leaver = await person('user')
  const imported = await person('user')
  await testDb.insert(statusSubscriptions).values([
    // Added by the team, not chosen by the customer.
    { principalId: imported, source: 'csv_import', createdAt: new Date('2026-01-15') },
    { principalId: owner, source: 'self_serve', createdAt: new Date('2026-02-01') },
    { principalId: tester, source: 'self_serve', createdAt: new Date('2026-02-02') },
    {
      principalId: leaver,
      source: 'self_serve',
      createdAt: new Date('2026-02-03'),
      unsubscribedAt: new Date('2026-02-04'),
    },
  ])
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
  const customer = await person('user')
  await testDb
    .insert(statusSubscriptions)
    .values({ principalId: customer, source: 'self_serve', createdAt: new Date('2026-03-01') })
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: '2026-03-01T00:00:00.000Z',
  })
  // Only the primary goal decides which win counts.
  expect(
    await detectFirstWin({ ...state, goals: ['customer_support', 'status_page'] })
  ).toMatchObject({ reached: false })
})

it('counts a helpful vote from someone outside the team as the help center win', async () => {
  const state = goalState('help_center')
  const owner = await person('admin')
  const [category] = await testDb
    .insert(helpCenterCategories)
    .values({ name: 'General', slug: `general-${createId('kb_category').slice(-6)}` })
    .returning()
  const [article] = await testDb
    .insert(helpCenterArticles)
    .values({
      categoryId: category!.id,
      title: 'Getting started',
      slug: 'getting-started',
      content: 'Hello',
      principalId: owner,
      publishedAt: new Date('2026-01-01'),
    })
    .returning()
  const tester = await person('user', { testOwner: owner })
  const unhappy = await person('user')
  await testDb.insert(helpCenterArticleFeedback).values([
    { articleId: article!.id, principalId: owner, helpful: true, createdAt: new Date('2026-02-01') },
    { articleId: article!.id, principalId: tester, helpful: true, createdAt: new Date('2026-02-02') },
    {
      articleId: article!.id,
      principalId: unhappy,
      helpful: false,
      createdAt: new Date('2026-02-03'),
    },
  ])
  // Publishing the article is the team's own act, not the win.
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
  // A signed-out visitor's vote has no principal: still someone outside the team.
  await testDb
    .insert(helpCenterArticleFeedback)
    .values({ articleId: article!.id, principalId: null, helpful: true, createdAt: new Date('2026-03-01') })
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: '2026-03-01T00:00:00.000Z',
  })
})

it('counts a helpful vote on a deleted article as no win', async () => {
  const state = goalState('help_center')
  const owner = await person('admin')
  const [category] = await testDb
    .insert(helpCenterCategories)
    .values({ name: 'General', slug: `general-${createId('kb_category').slice(-6)}` })
    .returning()
  const [article] = await testDb
    .insert(helpCenterArticles)
    .values({
      categoryId: category!.id,
      title: 'Old',
      slug: 'old',
      content: 'Hello',
      principalId: owner,
      deletedAt: new Date(),
    })
    .returning()
  const customer = await person('user')
  await testDb
    .insert(helpCenterArticleFeedback)
    .values({ articleId: article!.id, principalId: customer, helpful: true })
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
})

it('counts an idea on a private board only when a teammate other than the owner posts it', async () => {
  const state: SetupState = { ...goalState('product_feedback'), feedbackPrivate: true }
  const owner = await person('admin', { createdAt: new Date('2025-01-01') })
  const [board] = await testDb
    .insert(boards)
    .values({
      name: 'Team',
      slug: `team-${createId('board').slice(-6)}`,
      access: {
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    })
    .returning()
  await testDb.insert(posts).values({
    boardId: board!.id,
    principalId: owner,
    title: 'Mine',
    content: 'x',
    createdAt: new Date('2026-02-01'),
  })
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
  const teammate = await person('member')
  await testDb.insert(posts).values({
    boardId: board!.id,
    principalId: teammate,
    title: 'Theirs',
    content: 'x',
    createdAt: new Date('2026-03-01'),
  })
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: '2026-03-01T00:00:00.000Z',
  })
})

it('counts a conversation a customer starts by email as the support win, not one from GitHub', async () => {
  const state: SetupState = {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'customer_support',
    goals: ['customer_support'],
  }
  await testDb.delete(conversations)
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  for (const [source, at] of [
    ['github', '2026-02-01'],
    ['email', '2026-03-01'],
  ] as const) {
    if (source === 'email') {
      expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
    }
    const [created] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: source, source, createdAt: new Date(at) })
      .returning()
    await testDb.insert(conversationMessages).values({
      conversationId: created!.id,
      principalId,
      senderType: 'visitor',
      content: 'Hello Acme',
      createdAt: new Date(at),
    })
  }
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: '2026-03-01T00:00:00.000Z',
  })
})

it('counts only a conversation the customer opened, not one a teammate started', async () => {
  const state: SetupState = {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'customer_support',
    goals: ['customer_support'],
  }
  await testDb.delete(conversations)
  const people: PrincipalId[] = []
  for (const role of ['user', 'admin'] as const) {
    const userId = createId('user') as UserId
    const principalId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
    people.push(principalId)
  }
  const [customer, teammate] = people as [PrincipalId, PrincipalId]
  const [outbound] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: customer,
      channel: 'messenger',
      source: 'widget',
      createdAt: new Date('2026-02-01'),
    })
    .returning()
  await testDb.insert(conversationMessages).values([
    {
      conversationId: outbound!.id,
      principalId: teammate,
      senderType: 'agent',
      content: 'Acme here',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    },
    {
      conversationId: outbound!.id,
      principalId: customer,
      senderType: 'visitor',
      content: 'Thanks',
      createdAt: new Date('2026-02-01T01:00:00Z'),
    },
  ])
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })

  const [inbound] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: customer,
      channel: 'email',
      source: 'email',
      createdAt: new Date('2026-03-01'),
    })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: inbound!.id,
    principalId: customer,
    senderType: 'visitor',
    content: 'Hello Acme',
    createdAt: new Date('2026-03-01T00:00:00Z'),
  })
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: '2026-03-01T00:00:00.000Z',
  })
})
