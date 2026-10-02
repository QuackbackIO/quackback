import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { principal, user, conversations, eq, settings } from '@/lib/server/db'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { getOrCreateTestCustomer, mintTestCustomerToken } from '../test-customer'
import { isConversationsEnabledFor } from '../domains/settings/settings.support'
import {
  runGetMyConversation,
  runSendConversationMessage,
} from '@/lib/server/functions/conversation'
import { handleWidgetTestSession } from '@/routes/api/widget/test-session'

const fixture = await createDbTestFixture()
let owner: PrincipalId, ordinary: PrincipalId, customer: PrincipalId, customerUser: UserId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = createId('principal')
  ordinary = createId('principal')
  await testDb
    .insert(settings)
    .values({ id: createId('workspace'), name: 'Acme', slug: 'acme', createdAt: new Date() })
  const uid = createId('user')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'you@example.com' })
  await testDb.insert(principal).values([
    { id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() },
    { id: ordinary, role: 'user', type: 'anonymous', createdAt: new Date() },
  ])
  const created = await getOrCreateTestCustomer(owner, 'en')
  customer = created.id
  customerUser = created.userId as UserId
})
afterEach(fixture.rollback)
afterAll(fixture.close)

function widgetCtx(id: PrincipalId, userId: UserId): AuthContext {
  return {
    settings: {
      id: createId('workspace') as WorkspaceId,
      slug: 'acme',
      name: 'Acme',
      logoKey: null,
    },
    user: { id: userId, email: '', name: 'Visitor', image: null },
    principal: { id, role: 'user', type: 'anonymous' },
    permissions: [],
    scope: 'widget',
  }
}

it('opens conversations to a test customer while every visitor surface is off', async () => {
  expect(await isConversationsEnabledFor(ordinary)).toBe(false)
  expect(await isConversationsEnabledFor(owner)).toBe(false)
  expect(await isConversationsEnabledFor(null)).toBe(false)
  expect(await isConversationsEnabledFor(customer)).toBe(true)
})

it('lets a test customer send and read its thread, and still refuses an ordinary visitor', async () => {
  const ordinaryCtx = widgetCtx(ordinary, createId('user') as UserId)
  await expect(
    runSendConversationMessage(ordinaryCtx, { content: 'Hi! Is anyone there?' })
  ).rejects.toThrow(/not enabled/i)
  expect((await runGetMyConversation(ordinaryCtx, {})).enabled).toBe(false)

  const ctx = widgetCtx(customer, customerUser)
  await runSendConversationMessage(ctx, { content: 'Hi! Is anyone there?' })
  const thread = await runGetMyConversation(ctx, {})
  expect(thread.enabled).toBe(true)
  expect(thread.conversation).not.toBeNull()
  const [stored] = await testDb
    .select()
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, customer))
  expect(stored.customAttributes).toMatchObject({ test: true })
})

it('exchanges a test token for a Bearer once, without setting a cookie', async () => {
  const { token } = await mintTestCustomerToken(owner, 'en')
  const exchange = () =>
    handleWidgetTestSession(
      new Request('http://localhost/api/widget/test-session', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
    )
  const first = await exchange()
  expect(first.status).toBe(200)
  expect(first.headers.get('set-cookie')).toBeNull()
  const body = (await first.json()) as { data: { sessionToken: string; testSession: boolean } }
  expect(body.data.sessionToken).toMatch(/^customer-session-/)
  expect(body.data.testSession).toBe(true)
  expect((await exchange()).status).toBe(401)
})

it('refuses a malformed exchange body', async () => {
  const res = await handleWidgetTestSession(
    new Request('http://localhost/api/widget/test-session', { method: 'POST', body: 'nope' })
  )
  expect(res.status).toBe(401)
})
