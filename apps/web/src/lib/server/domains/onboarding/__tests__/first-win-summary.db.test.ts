/**
 * The named first win Home celebrates: who acted, on what, and where to see it.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversationMessages,
  conversations,
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
  posts,
  principal,
  statusSubscriptions,
  user,
  type SetupState,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { firstWinSummary } from '../first-win-summary'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const state = (goals: SetupState['goals']): SetupState => ({
  version: 2,
  steps: { core: true, workspace: true, startingPoint: null },
  goals,
})

async function person(role: 'user' | 'admin', name: string, email: string) {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email })
  await testDb
    .insert(principal)
    .values({ id, userId, role, type: 'user', displayName: name, createdAt: new Date() })
  return id
}

it('names the customer and the idea, never a teammate', async () => {
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: createId('board') })
    .returning()
  const owner = await person('admin', 'Sam Rivera', `sam-${createId('user')}@acme.example`)
  const ana = await person('user', 'Ana Silva', `ana-${createId('user')}@northwind.example`)
  await testDb.insert(posts).values([
    {
      boardId: board!.id,
      principalId: owner,
      title: 'Owner idea',
      content: '',
      createdAt: new Date('2026-10-01T09:00:00Z'),
    },
    {
      boardId: board!.id,
      principalId: ana,
      title: 'Export to CSV',
      content: '',
      voteCount: 1,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    },
  ])
  const summary = await firstWinSummary(state(['product_feedback']))
  expect(summary).toMatchObject({
    kind: 'idea',
    name: 'Ana Silva',
    domain: 'northwind.example',
    subject: 'Export to CSV',
    votes: 1,
  })
  expect(summary?.href).toMatch(/^\/admin\/feedback\?post=post_/)
})

it('names the customer who wrote in and links the conversation', async () => {
  const visitor = await person('user', 'Dev Ops', `dev-${createId('user')}@northwind.example`)
  const [thread] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor, channel: 'messenger', source: 'widget' })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: thread!.id,
    principalId: visitor,
    senderType: 'visitor',
    content: 'Hi! Is anyone there?',
  })
  const summary = await firstWinSummary(state(['customer_support']))
  expect(summary).toMatchObject({
    kind: 'conversation',
    name: 'Dev Ops',
    subject: 'Hi! Is anyone there?',
    href: `/admin/inbox?c=${thread!.id}`,
  })
})

it('names the first subscriber outside the team', async () => {
  const owner = await person('admin', 'Sam Rivera', `sam-${createId('user')}@acme.example`)
  const dev = await person('user', 'Dev', `dev-${createId('user')}@northwind.example`)
  await testDb.insert(statusSubscriptions).values([
    { principalId: owner, source: 'self_serve', createdAt: new Date('2026-10-01T09:00:00Z') },
    { principalId: dev, source: 'self_serve', createdAt: new Date('2026-10-01T10:00:00Z') },
  ])
  expect(await firstWinSummary(state(['status_page']))).toMatchObject({
    kind: 'subscriber',
    name: 'Dev',
    domain: 'northwind.example',
    href: '/admin/status?view=subscribers',
  })
})

it('never names a subscriber the team added, only one who subscribed themselves', async () => {
  const ana = await person('user', 'Ana', `ana-${createId('user')}@northwind.example`)
  const bo = await person('user', 'Bo', `bo-${createId('user')}@contoso.example`)
  await testDb.insert(statusSubscriptions).values([
    { principalId: ana, source: 'admin', createdAt: new Date('2026-10-01T09:00:00Z') },
    { principalId: bo, source: 'self_serve', createdAt: new Date('2026-10-01T10:00:00Z') },
  ])
  expect(await firstWinSummary(state(['status_page']))).toMatchObject({
    kind: 'subscriber',
    name: 'Bo',
    domain: 'contoso.example',
  })
})

it('names the article a signed-out visitor found helpful', async () => {
  const owner = await person('admin', 'Sam Rivera', `sam-${createId('user')}@acme.example`)
  const [category] = await testDb
    .insert(helpCenterCategories)
    .values({ name: 'General', slug: `general-${createId('kb_category').slice(-6)}` })
    .returning()
  const [article] = await testDb
    .insert(helpCenterArticles)
    .values({
      categoryId: category!.id,
      title: 'How do I reset my password?',
      slug: `reset-${createId('kb_category').slice(-6)}`,
      content: 'Hello',
      principalId: owner,
      publishedAt: new Date('2026-10-01T08:00:00Z'),
    })
    .returning()
  await testDb.insert(helpCenterArticleFeedback).values([
    { articleId: article!.id, principalId: owner, helpful: true, createdAt: new Date('2026-10-01T09:00:00Z') },
    { articleId: article!.id, principalId: null, helpful: true, createdAt: new Date('2026-10-01T10:00:00Z') },
  ])
  expect(await firstWinSummary(state(['help_center']))).toEqual({
    kind: 'helpful',
    name: null,
    domain: null,
    visitor: true,
    subject: 'How do I reset my password?',
    at: '2026-10-01T10:00:00.000Z',
    href: `/admin/help-center?article=${article!.id}`,
  })
})

it('has nothing to name before anyone outside the team acts', async () => {
  expect(await firstWinSummary(state(['status_page']))).toBeNull()
})
