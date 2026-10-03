import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import {
  principal,
  user,
  conversations,
  conversationMessages,
  assistantInvolvements,
  assistantToolCalls,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { getOrCreateTestCustomer } from '../test-customer'
import { loadAnalyticsData } from '../domains/analytics/analytics-dashboard'
import { listPortalUsers } from '../domains/users/user.service'
import { getQuinnPerformance } from '../domains/analytics/quinn-performance'
import { getQuinnToolMetrics } from '../domains/analytics/quinn-tools'

const fixture = await createDbTestFixture()
let owner: PrincipalId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = createId('principal')
  const id = createId('user')
  await testDb.insert(user).values({ id, name: 'Acme', email: `${id}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: owner, userId: id, type: 'user', role: 'admin', createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const analytics = () => loadAnalyticsData('7d')
it('keeps live support metrics and the lead directory unchanged for a test customer', async () => {
  const before = await analytics(),
    leads = await listPortalUsers({ lifecycle: 'leads' })
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const [conversation] = await testDb
    .insert(conversations)
    .values({
      channel: 'messenger',
      visitorPrincipalId: customer.id,
      assignedAgentPrincipalId: owner,
      status: 'closed',
      resolvedAt: new Date(),
      csatRating: 5,
      csatSubmittedAt: new Date(),
    })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: conversation.id,
    principalId: owner,
    senderType: 'agent',
    content: 'Hello',
  })
  const after = await analytics()
  expect(after).toEqual(before)
  expect(await listPortalUsers({ lifecycle: 'leads' })).toEqual(leads)
  const real = createId('principal')
  const realUser = createId('user')
  await testDb
    .insert(user)
    .values({ id: realUser, name: 'Acme', email: 'real@example.com', isAnonymous: true })
  await testDb.insert(principal).values({
    id: real,
    userId: realUser,
    type: 'anonymous',
    role: 'user',
    contactEmail: 'real@example.com',
    createdAt: new Date(),
  })
  // A real thread, and one carrying a legacy client `test` attribute: both count.
  await testDb.insert(conversations).values([
    {
      channel: 'messenger',
      visitorPrincipalId: real,
      status: 'closed',
      resolvedAt: new Date(),
      csatRating: 3,
      csatSubmittedAt: new Date(),
    },
    {
      channel: 'messenger',
      visitorPrincipalId: real,
      status: 'closed',
      resolvedAt: new Date(),
      csatRating: 4,
      csatSubmittedAt: new Date(),
      customAttributes: { test: true, testOwnerPrincipalId: owner },
    },
  ])
  const actual = await analytics()
  expect(actual.conversationVolume.total).toBe(before.conversationVolume.total + 2)
  expect(actual.csat.responseCount).toBe(before.csat.responseCount + 2)
  expect((await listPortalUsers({ lifecycle: 'leads' })).total).toBe(leads.total + 1)
})

it('keeps test replies out of Quinn performance and action metrics', async () => {
  const from = new Date(Date.now() - 86_400_000),
    to = new Date(Date.now() + 86_400_000)
  const before = await getQuinnPerformance(from, to),
    tools = await getQuinnToolMetrics(from, to)
  const customer = await getOrCreateTestCustomer(owner, 'en')
  const [test] = await testDb
    .insert(conversations)
    .values({
      channel: 'messenger',
      visitorPrincipalId: customer.id,
      status: 'closed',
      csatRating: 5,
      csatSubmittedAt: new Date(),
    })
    .returning()
  await testDb
    .insert(assistantInvolvements)
    .values({ conversationId: test.id, triggeredBy: 'first_touch', status: 'resolved_confirmed' })
  await testDb.insert(assistantToolCalls).values({
    conversationId: test.id,
    toolName: 'search',
    args: { query: 'Acme' },
    status: 'succeeded',
  })
  expect(await getQuinnPerformance(from, to)).toEqual(before)
  expect(await getQuinnToolMetrics(from, to)).toEqual(tools)
  // The teammate's own thread with a legacy marker is real and counts.
  const [real] = await testDb
    .insert(conversations)
    .values({ channel: 'messenger', visitorPrincipalId: owner, customAttributes: { test: true } })
    .returning()
  await testDb
    .insert(assistantInvolvements)
    .values({ conversationId: real.id, triggeredBy: 'first_touch', status: 'active' })
  const result = await getQuinnPerformance(from, to)
  expect(result.involvements).toBe(before.involvements + 1)
  expect(result.conversations).toBe(before.conversations + 1)
})
