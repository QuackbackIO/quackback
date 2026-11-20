/**
 * The in-thread ticket form (a workflow's send_ticket_form block) asks for an
 * email only when filing would need one: an anonymous visitor with no contact
 * email on file. An identified customer, or an anonymous one who already gave
 * an email, is never asked. Real Postgres, through the thread load the widget
 * and the portal both read.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { principal, user, eq, settings } from '@/lib/server/db'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { getOrCreateTestCustomer } from '../test-customer'
import {
  runGetMyConversation,
  runSendConversationMessage,
} from '@/lib/server/functions/conversation'

const fixture = await createDbTestFixture()

/** A teammate's test customer: anonymous, with no email on file. */
async function seedVisitor(): Promise<AuthContext> {
  const owner = createId('principal')
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: 'acme',
    createdAt: new Date(),
  })
  const uid = createId('user')
  await testDb.insert(user).values({ id: uid, name: 'Acme', email: 'owner@example.com' })
  await testDb
    .insert(principal)
    .values({ id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
  const customer = await getOrCreateTestCustomer(owner, 'en')
  await testDb
    .update(principal)
    .set({ contactEmail: null })
    .where(eq(principal.id, customer.id as PrincipalId))
  return {
    settings: {
      id: createId('workspace') as WorkspaceId,
      slug: 'acme',
      name: 'Acme',
      logoKey: null,
    },
    user: { id: customer.userId as UserId, email: '', name: 'Visitor', image: null },
    principal: { id: customer.id as PrincipalId, role: 'user', type: 'anonymous' },
    permissions: [],
    scope: 'widget',
  }
}

async function asksEmail(ctx: AuthContext): Promise<boolean> {
  const sent = await runSendConversationMessage(ctx, { content: 'I need a hand' })
  if ('ok' in sent) throw new Error('A plain message is never refused as a rating')
  const thread = await runGetMyConversation(ctx, { conversationId: sent.conversation.id })
  return thread.ticketFormAsksEmail
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

describe('the in-thread ticket form email field', () => {
  it('is asked of an anonymous visitor with no email on file', async () => {
    expect(await asksEmail(await seedVisitor())).toBe(true)
  })

  it('is not asked of an anonymous visitor whose email is already on file', async () => {
    const ctx = await seedVisitor()
    await testDb
      .update(principal)
      .set({ contactEmail: 'sam@example.com' })
      .where(eq(principal.id, ctx.principal.id))
    expect(await asksEmail(ctx)).toBe(false)
  })

  it('is not asked of an identified customer', async () => {
    const ctx = await seedVisitor()
    await testDb.update(principal).set({ type: 'user' }).where(eq(principal.id, ctx.principal.id))
    const identified: AuthContext = {
      ...ctx,
      user: { ...ctx.user, email: 'sam@example.com' },
      principal: { ...ctx.principal, type: 'user' },
    }
    expect(await asksEmail(identified)).toBe(false)
  })
})
