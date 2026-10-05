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
  eq,
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
  posts,
  postVotes,
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
import { detectFirstWin } from '@/lib/server/activation-wins'

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

async function person(
  role: 'user' | 'admin' | 'member',
  name: string,
  email: string,
  createdAt = new Date()
) {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email })
  await testDb
    .insert(principal)
    .values({ id, userId, role, type: 'user', displayName: name, createdAt })
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

it('names a customer vote that came first, and the idea they voted for', async () => {
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: createId('board') })
    .returning()
  const owner = await person('admin', 'Sam Rivera', `sam-${createId('user')}@acme.example`)
  const ana = await person('user', 'Ana Silva', `ana-${createId('user')}@northwind.example`)
  const bo = await person('user', 'Bo Chen', `bo-${createId('user')}@contoso.example`)
  const [seeded] = await testDb
    .insert(posts)
    .values({
      boardId: board!.id,
      principalId: owner,
      title: 'Dark mode',
      content: '',
      voteCount: 1,
      createdAt: new Date('2026-10-01T09:00:00Z'),
    })
    .returning()
  await testDb.insert(postVotes).values({
    postId: seeded!.id,
    principalId: ana,
    createdAt: new Date('2026-10-01T09:30:00Z'),
  })
  await testDb.insert(posts).values({
    boardId: board!.id,
    principalId: bo,
    title: 'Export to CSV',
    content: '',
    createdAt: new Date('2026-10-01T10:00:00Z'),
  })
  const summary = await firstWinSummary(state(['product_feedback']))
  expect(summary).toMatchObject({
    kind: 'vote',
    name: 'Ana Silva',
    domain: 'northwind.example',
    subject: 'Dark mode',
    votes: 1,
    at: '2026-10-01T09:30:00.000Z',
    href: `/admin/feedback?post=${seeded!.id}`,
  })
  expect((await detectFirstWin(state(['product_feedback']))).reachedAt).toBe(summary?.at)
})

it('names the idea when a customer posted before anyone voted', async () => {
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: createId('board') })
    .returning()
  const ana = await person('user', 'Ana Silva', `ana-${createId('user')}@northwind.example`)
  const bo = await person('user', 'Bo Chen', `bo-${createId('user')}@contoso.example`)
  const [idea] = await testDb
    .insert(posts)
    .values({
      boardId: board!.id,
      principalId: ana,
      title: 'Export to CSV',
      content: '',
      createdAt: new Date('2026-10-01T09:00:00Z'),
    })
    .returning()
  await testDb.insert(postVotes).values({
    postId: idea!.id,
    principalId: bo,
    createdAt: new Date('2026-10-01T09:30:00Z'),
  })
  expect(await firstWinSummary(state(['product_feedback']))).toMatchObject({
    kind: 'idea',
    name: 'Ana Silva',
    subject: 'Export to CSV',
  })
})

const TEAM_ACCESS = {
  view: 'team',
  vote: 'team',
  comment: 'team',
  submit: 'team',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
} as const

it('names the teammate idea the private-board win counted, on the setup board only', async () => {
  const owner = await person(
    'admin',
    'Sam Rivera',
    `sam-${createId('user')}@acme.example`,
    new Date('2000-01-01T00:00:00Z')
  )
  const teammate = await person('member', 'Kai Lee', `kai-${createId('user')}@acme.example`)
  const [other] = await testDb
    .insert(boards)
    .values({ name: 'Leadership', slug: createId('board'), access: TEAM_ACCESS })
    .returning()
  const [team] = await testDb
    .insert(boards)
    .values({ name: 'Team ideas', slug: createId('board'), access: TEAM_ACCESS })
    .returning()
  await testDb.insert(posts).values([
    {
      boardId: other!.id,
      principalId: teammate,
      title: 'Elsewhere',
      content: '',
      createdAt: new Date('2026-10-01T08:00:00Z'),
    },
    {
      boardId: team!.id,
      principalId: owner,
      title: 'Owner idea',
      content: '',
      createdAt: new Date('2026-10-01T09:00:00Z'),
    },
    {
      boardId: team!.id,
      principalId: teammate,
      title: 'Weekly demo',
      content: '',
      createdAt: new Date('2026-10-01T10:00:00Z'),
    },
  ])
  const internal: SetupState = {
    version: 2,
    goals: ['product_feedback'],
    feedbackPrivate: true,
    steps: {
      core: true,
      workspace: true,
      startingPoint: {
        outcome: 'internal',
        resourceType: 'board',
        resourceId: team!.id,
        source: 'wizard',
        resolution: 'created',
        completedAt: '2026-10-01T07:00:00.000Z',
      },
    },
  }
  const summary = await firstWinSummary(internal)
  expect(summary).toMatchObject({ kind: 'teamIdea', name: 'Kai Lee', subject: 'Weekly demo' })
  expect((await detectFirstWin(internal)).reachedAt).toBe(summary?.at)
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
    {
      articleId: article!.id,
      principalId: owner,
      helpful: true,
      createdAt: new Date('2026-10-01T09:00:00Z'),
    },
    {
      articleId: article!.id,
      principalId: null,
      helpful: true,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    },
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

async function anonymousVisitor(displayName: string | null) {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Anonymous', email: `temp-${userId}@anon.example` })
  await testDb
    .insert(principal)
    .values({ id, userId, role: 'user', type: 'anonymous', displayName, createdAt: new Date() })
  return id
}

it('names an anonymous idea by the visitor generated name, else as a visitor', async () => {
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Ideas', slug: createId('board') })
    .returning()
  const snowy = await anonymousVisitor('Snowy Cardinal')
  await testDb.insert(posts).values({
    boardId: board!.id,
    principalId: snowy,
    title: 'Dark mode',
    content: '',
    createdAt: new Date('2026-10-01T10:00:00Z'),
  })
  const named = await firstWinSummary(state(['product_feedback']))
  expect(named).toMatchObject({ kind: 'idea', name: 'Snowy Cardinal', domain: null })
  expect(named?.visitor).toBeUndefined()

  await testDb.delete(posts).where(eq(posts.principalId, snowy))
  const nameless = await anonymousVisitor(null)
  await testDb.insert(posts).values({
    boardId: board!.id,
    principalId: nameless,
    title: 'Dark mode',
    content: '',
    createdAt: new Date('2026-10-01T10:00:00Z'),
  })
  expect(await firstWinSummary(state(['product_feedback']))).toMatchObject({
    kind: 'idea',
    name: null,
    domain: null,
    visitor: true,
  })
})

it('has nothing to name before anyone outside the team acts', async () => {
  expect(await firstWinSummary(state(['status_page']))).toBeNull()
})
