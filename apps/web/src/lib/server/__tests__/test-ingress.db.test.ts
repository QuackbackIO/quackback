import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type BoardId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import {
  principal,
  user,
  boards,
  posts,
  conversations,
  eq,
  channelAccounts,
  analyticsDailyStats,
  events,
  settings,
  sql,
  type SetupState,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { getOrCreateTestCustomer } from '../test-customer'
import { createPost } from '../domains/posts/post.service'
import { createEmailConversation } from '../domains/conversation/conversation.email-cold-inbound'
import { parseRawEmail } from '../domains/conversation/conversation.email-inbound'
import { refreshAnalytics } from '../domains/analytics/analytics.service'
import { detectFirstWin } from '../activation-wins'
import { emit } from '../events/emit'
import { postCreated } from '../events/catalogue/post'
import { createSlaPolicy } from '../domains/sla/sla-policy.service'
import { updateDefaultSlaPolicySettings } from '../domains/settings/settings.sla-default'
import { createSegment } from '../domains/segments/segment.service'
import { evaluateDynamicSegment, getSegmentMembers } from '../domains/segments/segment.evaluation'

const fixture = await createDbTestFixture()
let owner: PrincipalId, customer: PrincipalId, ordinary: PrincipalId, boardId: BoardId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = createId('principal')
  ordinary = createId('principal')
  boardId = createId('board')
  await testDb
    .insert(settings)
    .values({ id: createId('workspace'), name: 'Acme', slug: 'acme', createdAt: new Date() })
  const uid = createId('user')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: `${uid}@example.com` })
  await testDb.insert(principal).values([
    { id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() },
    { id: ordinary, role: 'user', type: 'anonymous', createdAt: new Date() },
  ])
  customer = (await getOrCreateTestCustomer(owner, 'en')).id
  await testDb.insert(boards).values({
    id: boardId,
    name: 'Feedback',
    slug: String(boardId),
    access: { ...DEFAULT_BOARD_ACCESS, view: 'anonymous', submit: 'anonymous' },
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

function actor(id: PrincipalId): Actor {
  return {
    principalId: id,
    role: id === owner ? 'admin' : 'user',
    principalType: id === owner ? 'user' : 'anonymous',
    segmentIds: new Set(),
  }
}

it('writes protected test markers on customer ideas and teammate visitor ideas only', async () => {
  const create = (id: PrincipalId, visitorIngress: boolean, metadata: Record<string, string>) =>
    createPost(
      { boardId, title: 'An idea', content: '', widgetMetadata: metadata },
      { principalId: id, actor: actor(id) },
      { skipDispatch: true, visitorIngress }
    )
  const demo = await create(customer, true, { test: 'false' })
  const self = await create(owner, true, {})
  const real = await create(owner, false, { test: 'true', onboardingGenerated: 'true' })
  const forged = await create(ordinary, true, {
    test: 'true',
    testOwnerPrincipalId: owner,
    source: 'widget',
  })
  const read = (id: typeof demo.id) => testDb.query.posts.findFirst({ where: eq(posts.id, id) })
  expect((await read(demo.id))!.widgetMetadata).toMatchObject({
    test: 'true',
    testOwnerPrincipalId: owner,
  })
  expect((await read(self.id))!.widgetMetadata).toMatchObject({
    test: 'true',
    testOwnerPrincipalId: owner,
  })
  expect((await read(real.id))!.widgetMetadata).toEqual({})
  expect((await read(forged.id))!.widgetMetadata).toEqual({ source: 'widget' })
})

it('tags cold email from a teammate but keeps an ordinary sender real', async () => {
  const parsed = parseRawEmail(
    'From: you@example.com\r\nTo: inbox@example.com\r\nSubject: Hello\r\n\r\nHello'
  )
  const team = await testDb.query.teams.findFirst()
  expect(team).toBeDefined()
  const [channel] = await testDb
    .insert(channelAccounts)
    .values({ owningTeamId: team!.id, role: 'sending', address: `${boardId}@example.com` })
    .returning()
  const create = (id: PrincipalId) =>
    createEmailConversation({
      parsed,
      channelAccountId: channel.id,
      principalId: id,
      unverified: true,
      content: 'Hello',
      quarantine: { cause: 'manual', note: 'Held' },
    })
  const self = await create(owner),
    real = await create(ordinary)
  expect(
    (await testDb.query.conversations.findFirst({ where: eq(conversations.id, self) }))!
      .customAttributes
  ).toEqual({ unverifiedSender: true, test: true, testOwnerPrincipalId: owner })
  expect(
    (await testDb.query.conversations.findFirst({ where: eq(conversations.id, real) }))!
      .customAttributes
  ).toEqual({ unverifiedSender: true })
})

it('starts the default SLA on a real conversation but never on a test one', async () => {
  const policy = await createSlaPolicy({ name: 'Default', firstResponseTargetSecs: 3600 })
  await updateDefaultSlaPolicySettings({ policyId: policy.id })
  const parsed = parseRawEmail(
    'From: you@example.com\r\nTo: inbox@example.com\r\nSubject: Hello\r\n\r\nHello'
  )
  const team = await testDb.query.teams.findFirst()
  const [channel] = await testDb
    .insert(channelAccounts)
    .values({ owningTeamId: team!.id, role: 'sending', address: `${boardId}@example.com` })
    .returning()
  const create = (id: PrincipalId) =>
    createEmailConversation({
      parsed,
      channelAccountId: channel.id,
      principalId: id,
      unverified: true,
      content: 'Hello',
    })
  const self = await create(owner),
    real = await create(ordinary)
  const stamp = async (id: typeof self) =>
    (await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) }))!.slaApplied
  expect(await stamp(self)).toBeNull()
  expect(await stamp(real)).toMatchObject({ policyId: policy.id })
})

it('keeps an identified test customer out of a dynamic segment a real person matches', async () => {
  const realUser = createId('user')
  await testDb.insert(user).values({ id: realUser, name: 'Real', email: `${realUser}@example.com` })
  await testDb
    .update(principal)
    .set({ type: 'user', userId: realUser })
    .where(eq(principal.id, ordinary))
  await testDb.update(principal).set({ type: 'user' }).where(eq(principal.id, customer))
  const segment = await createSegment({
    name: 'People',
    type: 'dynamic',
    rules: {
      match: 'all',
      conditions: [{ attribute: 'principal_type', operator: 'eq', value: 'user' }],
    },
  })
  await evaluateDynamicSegment(segment.id)
  const members = await getSegmentMembers(segment.id)
  expect(members).toContain(ordinary)
  expect(members).not.toContain(customer)
})

it('keeps hourly feedback rollups unchanged for test ideas and counts real work', async () => {
  const date = new Date().toISOString().slice(0, 10)
  const snapshot = async () => {
    await refreshAnalytics()
    const row = await testDb.query.analyticsDailyStats.findFirst({
      where: eq(analyticsDailyStats.date, date),
    })
    return {
      posts: row!.newPosts,
      votes: row!.newVotes,
      comments: row!.newComments,
      boards: row!.postsByBoard,
      statuses: row!.postsByStatus,
    }
  }
  const before = await snapshot()
  await createPost(
    { boardId, title: 'A test idea', content: '' },
    { principalId: customer, actor: actor(customer) },
    { skipDispatch: true, visitorIngress: true }
  )
  expect(await snapshot()).toEqual(before)
  await createPost(
    { boardId, title: 'A real idea', content: '' },
    { principalId: owner, actor: actor(owner) },
    { skipDispatch: true }
  )
  const after = await snapshot()
  expect(after.posts).toBe(before.posts + 1)
  expect(after.votes).toBe(before.votes + 1)
  expect(after.boards[boardId]).toBe(1)
})

it('waits for a real idea for the private-feedback first win', async () => {
  const state: SetupState = {
    version: 2,
    goals: ['product_feedback'],
    feedbackPrivate: true,
    steps: {
      core: true,
      workspace: true,
      startingPoint: {
        outcome: 'internal',
        resourceType: 'board',
        resourceId: boardId,
        source: 'wizard',
        resolution: 'created',
        completedAt: new Date().toISOString(),
      },
    },
  }
  await createPost(
    { boardId, title: 'A test idea', content: '' },
    { principalId: customer, actor: actor(customer) },
    { skipDispatch: true, visitorIngress: true }
  )
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
  const real = await createPost(
    { boardId, title: 'A real idea', content: '' },
    { principalId: owner, actor: actor(owner) },
    { skipDispatch: true }
  )
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: real.createdAt.toISOString(),
  })
})

it('retains a test event locally without scheduling delivery, while real events still dispatch', async () => {
  const create = (id: PrincipalId) =>
    createPost(
      { boardId, title: 'An idea', content: '' },
      { principalId: id, actor: actor(id) },
      { skipDispatch: true }
    )
  const test = await create(customer),
    real = await create(owner)
  const publish = (post: typeof test) =>
    emit(testDb, postCreated, {
      entityId: post.id,
      actor: { type: 'user', id: owner },
      payload: {
        post: {
          id: post.id,
          title: post.title,
          content: post.content,
          boardId,
          boardSlug: String(boardId),
          voteCount: 1,
        },
      },
    })
  const testEvent = await publish(test),
    realEvent = await publish(real)
  const row = await testDb.query.events.findFirst({ where: eq(events.eventId, testEvent) })
  expect(row!.publishedAt).not.toBeNull()
  const jobs = (id: string) =>
    testDb.execute(sql`select id from job_queue where payload->>'eventId' = ${id}`)
  expect(await jobs(testEvent)).toHaveLength(0)
  expect(await jobs(realEvent)).toHaveLength(1)
})
