import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  eq,
  isTestRecord,
  principal,
  settings,
  tickets,
  ticketStatuses,
} from '@/lib/server/db'
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
  const { requester, owner, actor } = await seedIdentity(kind)
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
  const [row] = await testDb
    .select({ attributes: tickets.customAttributes })
    .from(tickets)
    .where(eq(tickets.id, ticket.id))
  const conversation = paired
    ? await testDb.query.conversations.findFirst({
        where: eq(conversations.visitorPrincipalId, requester.id),
      })
    : undefined
  return {
    attributes: row.attributes,
    conversation,
    ownerId: kind === 'teammate' ? requester.id : owner.id,
  }
}

describe.skipIf(!fixture.available)('ticket intake protects server test markers (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    if (
      !(await testDb.query.ticketStatuses.findFirst({ where: eq(ticketStatuses.isDefault, true) }))
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
    'cannot forge test markers from requester intake (paired=%s)',
    async (paired) => {
      const { attributes, conversation } = await createIntake(
        'visitor',
        { test: true, onboardingGenerated: 'true', testOwnerPrincipalId: 'forged', note: 'Acme' },
        paired
      )
      expect(attributes).toEqual({ note: 'Acme' })
      expect(isTestRecord(attributes)).toBe(false)
      if (paired) expect(conversation?.customAttributes).toEqual({ note: 'Acme' })
    }
  )

  it.each(['test', 'teammate'] as const)(
    '%s intake derives its server markers despite a client attempt to clear them',
    async (kind) => {
      const { attributes, conversation, ownerId } = await createIntake(
        kind,
        { test: false, onboardingGenerated: false, testOwnerPrincipalId: 'forged', note: 'Acme' },
        true
      )
      expect(attributes).toEqual({ test: true, testOwnerPrincipalId: ownerId, note: 'Acme' })
      expect(conversation?.customAttributes).toEqual(attributes)
      expect(isTestRecord(attributes)).toBe(true)
    }
  )

  it.each([
    { source: 'marked', metadata: { test: true }, expected: true },
    { source: 'marked', metadata: { test: 'true' }, expected: true },
    { source: 'marked', metadata: { onboardingGenerated: true }, expected: true },
    { source: 'marked', metadata: { onboardingGenerated: 'true' }, expected: true },
    { source: 'test', metadata: {}, expected: true },
    { source: 'teammate', metadata: { test: true }, expected: true },
    { source: 'teammate', metadata: {}, expected: false },
    { source: 'visitor', metadata: {}, expected: false },
  ] as const)(
    'inherits server test state when creating from $source, $metadata',
    async ({ source, metadata, expected }) => {
      const { requester, owner } = await seedIdentity(source === 'marked' ? 'visitor' : source)
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
      const [row] = await testDb
        .select({ attributes: tickets.customAttributes })
        .from(tickets)
        .where(eq(tickets.id, created.id))
      expect(isTestRecord(row.attributes)).toBe(expected)
      expect(row.attributes.note).toBe('Acme')
      if (source === 'test') expect(row.attributes.testOwnerPrincipalId).toBe(owner.id)
      if (source === 'teammate' && expected)
        expect(row.attributes.testOwnerPrincipalId).toBe(requester.id)
      if (!expected) expect(row.attributes).toEqual({ note: 'Acme' })
    }
  )

  it('preserves ordinary intake attributes without marking a customer ticket', async () => {
    const { attributes } = await createIntake('visitor', { test_notes: 'Acme', plan: 'Pro' }, false)
    expect(attributes).toEqual({ test_notes: 'Acme', plan: 'Pro' })
    expect(isTestRecord(attributes)).toBe(false)
  })
})
