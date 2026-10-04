import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  eq,
  principal,
  settings,
  sql,
  tickets,
  ticketStatuses,
} from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { notTestConversation, notTestTicket } from '@/lib/server/test-data'
import type { Actor } from '@/lib/server/policy/types'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { createTicketCore } from '../ticket-intake.service'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3100' },
  getBaseUrl: () => 'http://localhost:3100',
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn((id, event) => {
    expect(event.kind).toBe('ticket_updated')
    expect(event.ticket.id).toBe(id)
  }),
}))
vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn(async (actor, ticket, state) => {
    expect(actor.principalId).toBeTruthy()
    expect(ticket.id).toBeTruthy()
    expect(state.category).toBe('open')
  }),
}))
vi.mock('../ticket-activity.service', () => ({
  recordTicketActivity: vi.fn((input) => {
    expect(input.type).toBe('ticket.created')
    expect(input.ticketId).toBeTruthy()
    expect(input.principalId).toBeTruthy()
  }),
}))
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(async (actor, author, conversation) => {
    expect(actor.principalId).toBeTruthy()
    expect(author.principalId).toBeTruthy()
    expect(conversation.channel).toBe('messenger')
  }),
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ testOwner: principal.testOwnerPrincipalId }).from(principal).limit(0)
  },
})

async function seedIdentity(kind: 'visitor' | 'test' | 'teammate') {
  const [owner] = await testDb
    .insert(principal)
    .values({ type: 'user', role: 'admin', createdAt: new Date() })
    .returning()
  const principalType: Actor['principalType'] = kind === 'teammate' ? 'user' : 'anonymous'
  const role: Actor['role'] = kind === 'teammate' ? 'member' : 'user'
  const [requester] = await testDb
    .insert(principal)
    .values({
      type: principalType,
      role,
      testOwnerPrincipalId: kind === 'test' ? owner.id : null,
      createdAt: new Date(),
    })
    .returning()
  const actor: Actor = {
    principalId: requester.id,
    principalType,
    role,
    permissions: resolveActorPermissions(role),
    segmentIds: new Set(),
  }
  return { requester, owner, actor }
}

async function createIntake(
  kind: 'visitor' | 'test' | 'teammate',
  attrs: Record<string, unknown>,
  paired: boolean
) {
  const { requester, actor } = await seedIdentity(kind)
  const ticket = await createTicketCore(
    {
      type: 'customer',
      title: 'Acme',
      requesterPrincipalId: requester.id,
      customAttributes: attrs,
      withBackingConversation: paired,
    },
    actor
  )
  return { ticketId: ticket.id, requester }
}

async function ticketState(ticketId: TicketId) {
  const [row] = await testDb
    .select({
      attributes: tickets.customAttributes,
      real: sql<boolean>`${notTestTicket(tickets.id)}`,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  return row
}

describe.skipIf(!fixture.available)(
  'ticket intake: test status follows the requester (real DB)',
  () => {
    beforeEach(async () => {
      await fixture.begin()
      if (
        !(await testDb.query.ticketStatuses.findFirst({
          where: eq(ticketStatuses.isDefault, true),
        }))
      ) {
        await testDb.insert(ticketStatuses).values({
          name: 'Open',
          slug: 'acme-open',
          category: 'open',
          isDefault: true,
          publicStage: 'received',
        })
      }
      if (!(await testDb.query.settings.findFirst())) {
        await testDb.insert(settings).values({ name: 'Acme', slug: 'acme', createdAt: new Date() })
      }
    })
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it.each([false, true])(
      'stores client attributes as sent; a visitor ticket stays real whatever they claim (paired=%s)',
      async (paired) => {
        const claimed = {
          test: true,
          onboardingGenerated: 'true',
          testOwnerPrincipalId: 'forged',
          note: 'Acme',
        }
        const { ticketId, requester } = await createIntake('visitor', claimed, paired)
        expect(await ticketState(ticketId)).toEqual({ attributes: claimed, real: true })
        if (paired) {
          const conversation = await testDb.query.conversations.findFirst({
            where: eq(conversations.visitorPrincipalId, requester.id),
          })
          expect(conversation).toBeDefined()
        }
      }
    )

    it.each([
      { kind: 'test', real: false },
      { kind: 'teammate', real: true },
    ] as const)('a $kind requester decides the ticket and its pair', async ({ kind, real }) => {
      const { ticketId, requester } = await createIntake(kind, { test: !real, note: 'Acme' }, true)
      expect((await ticketState(ticketId)).real).toBe(real)
      const [pair] = await testDb
        .select({ real: sql<boolean>`${notTestConversation(conversations.id)}` })
        .from(conversations)
        .where(eq(conversations.visitorPrincipalId, requester.id))
      expect(pair.real).toBe(real)
    })

    it.each([
      { source: 'legacy marker', kind: 'visitor', metadata: { test: 'true' }, real: true },
      { source: 'test customer', kind: 'test', metadata: {}, real: false },
      { source: 'teammate', kind: 'teammate', metadata: { test: true }, real: true },
    ] as const)(
      'a ticket created from a $source conversation follows that identity',
      async ({ kind, metadata, real }) => {
        const { requester, owner } = await seedIdentity(kind)
        const [conversation] = await testDb
          .insert(conversations)
          .values({
            visitorPrincipalId: requester.id,
            channel: 'messenger',
            customAttributes: metadata,
          })
          .returning()
        const actor: Actor = {
          principalId: owner.id,
          role: 'admin',
          principalType: 'user',
          permissions: resolveActorPermissions('admin'),
          segmentIds: new Set(),
        }
        const created = await createTicketCore(
          {
            type: 'customer',
            title: 'Acme',
            requesterPrincipalId: requester.id,
            sourceConversationId: conversation.id,
            customAttributes: { note: 'Acme' },
          },
          actor
        )
        expect(await ticketState(created.id)).toEqual({ attributes: { note: 'Acme' }, real })
      }
    )
  }
)
