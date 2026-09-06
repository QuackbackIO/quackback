/**
 * Real-DB coverage for the condition-context resolver (§4.6, Slice 4): it reads a
 * conversation's status/channel/priority, derives waiting-minutes from
 * waiting_since, collects tag ids + the visitor's segment ids, and threads
 * through the passed-in message + CSAT. Feeds straight into the pure evaluator.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type SegmentId,
  type ConversationTagId,
  type CompanyId,
  type TicketId,
  type TicketTypeId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationTags,
  conversationTagAssignments,
  segments,
  userSegments,
  user,
  principal,
  teams,
  companies,
  tickets,
  ticketTypes,
  ticketStatuses,
  ticketConversations,
} from '@/lib/server/db'
import { ANON_EMAIL_DOMAIN } from '@quackback/email/anon'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The workspace office-hours schedule (settings blob). Mutable per test; the
// default (disabled) evaluates 24/7-open.
const workspaceHours = vi.hoisted(() => ({
  schedule: {
    enabled: false,
    timezone: 'UTC',
    intervals: [] as { day: number; start: string; end: string }[],
  },
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => workspaceHours.schedule),
}))

import { resolveConditionContext } from '../condition.context'
import { evaluateCondition } from '../condition.evaluator'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: userSegments.principalId }).from(userSegments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(
  opts: {
    email?: string | null
    metadata?: Record<string, unknown>
    companyId?: CompanyId | null
    country?: string | null
    locale?: string | null
  } = {}
): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: `Visitor-${suffix()}`,
    email: opts.email,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    country: opts.country ?? null,
    locale: opts.locale ?? null,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'member',
    type: 'user',
    createdAt: new Date(),
    companyId: opts.companyId ?? null,
  })
  return principalId
}

/** One live ticket type in the customer category — what `ticket.type`
 *  compares against (the registry id, not the coarse category). */
async function seedTicketType(name: string): Promise<TicketTypeId> {
  const [type] = await testDb
    .insert(ticketTypes)
    .values({ name, slug: `${name.toLowerCase()}-${suffix()}`, category: 'customer' })
    .returning()
  return type.id
}

/** A customer ticket paired 1:1 with `conversationId`. `ticketTypeId` null
 *  seeds the legacy shape: a ticket from before the type registry existed. */
async function seedCustomerTicket(
  conversationId: ConversationId,
  ticketTypeId: TicketTypeId | null
): Promise<TicketId> {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: `open-${suffix()}` })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ title: `Ticket-${suffix()}`, statusId: status.id, type: 'customer', ticketTypeId })
    .returning()
  await testDb
    .insert(ticketConversations)
    .values({ ticketId: ticket.id, conversationId, ticketType: 'customer' })
  return ticket.id
}

/** An unidentified visitor: no user row, so both attribute stores miss. */
async function seedAnonymousPrincipal(): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(principal).values({
    id: principalId,
    userId: null,
    role: 'user',
    type: 'anonymous',
    createdAt: new Date(),
  })
  return principalId
}

describe.skipIf(!fixture.available)('resolveConditionContext (real DB, rolled back)', () => {
  beforeEach(() => {
    workspaceHours.schedule = { enabled: false, timezone: 'UTC', intervals: [] }
    return fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('assembles a full snapshot (status, waiting minutes, tags, segments, csat, message, team)', async () => {
    const principalId = await seedPrincipal()
    const [team] = await testDb
      .insert(teams)
      .values({ name: `Support-${suffix()}` })
      .returning()
    const waitingSince = new Date('2026-01-05T10:00:00Z')
    const [conv] = await testDb
      .insert(conversations)
      .values({
        visitorPrincipalId: principalId,
        channel: 'messenger',
        priority: 'high',
        waitingSince,
        csatRating: 4,
        customAttributes: { plan: { v: 'pro', src: 'teammate', at: '2026-01-05T09:00:00Z' } },
        assignedTeamId: team!.id,
      })
      .returning()

    // One tag, attached.
    const tagId = createId('conversation_tag') as ConversationTagId
    await testDb.insert(conversationTags).values({ id: tagId, name: `vip-${suffix()}` })
    await testDb
      .insert(conversationTagAssignments)
      .values({ conversationId: conv.id, conversationTagId: tagId })

    // One segment membership for the visitor.
    const segmentId = createId('segment') as SegmentId
    await testDb
      .insert(segments)
      .values({ id: segmentId, name: 'Paid', slug: `paid-${suffix()}`, type: 'manual' })
    await testDb.insert(userSegments).values({ principalId, segmentId })

    // Resolve 30 minutes after waiting started.
    const ctx = await resolveConditionContext(conv.id, {
      message: { body: 'Please help' },
      at: new Date('2026-01-05T10:30:00Z'),
    })
    expect(ctx).not.toBeNull()
    expect(ctx!.conversation.status).toBe('open')
    expect(ctx!.conversation.channel).toBe('messenger')
    expect(ctx!.conversation.priority).toBe('high')
    expect(ctx!.conversation.waitingMinutes).toBe(30)
    expect(ctx!.conversation.tagIds).toEqual([tagId])
    expect(ctx!.conversation.assignedTeamId).toBe(team!.id)
    expect(ctx!.conversation.attributes).toEqual({
      plan: { v: 'pro', src: 'teammate', at: '2026-01-05T09:00:00Z' },
    })
    expect(ctx!.person!.segmentIds).toEqual([segmentId])
    expect(ctx!.csatRating).toBe(4)
    expect(ctx!.message).toEqual({ body: 'Please help' })
    // Disabled workspace schedule = 24/7 = always within office hours.
    expect(ctx!.officeHours).toBe(true)

    // And it drives the evaluator end-to-end.
    expect(
      evaluateCondition(
        {
          all: [
            { field: 'conversation.waiting_minutes', op: 'gt', value: 15 },
            { field: 'person.segments', op: 'includes_any', value: [segmentId] },
            { field: 'message.body', op: 'contains', value: 'help' },
            { field: 'conversation.attr.plan', op: 'eq', value: 'pro' },
            { field: 'conversation.team', op: 'eq', value: team!.id },
          ],
        },
        ctx!
      )
    ).toBe(true)
  })

  it('reports null waiting minutes when nobody is waiting, and null for a missing conversation', async () => {
    const principalId = await seedPrincipal()
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'email' }) // no waitingSince
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.conversation.waitingMinutes).toBeNull()
    expect(ctx!.conversation.tagIds).toEqual([])
    expect(ctx!.conversation.assignedTeamId).toBeNull()
    expect(ctx!.person!.segmentIds).toEqual([])
    expect(ctx!.csatRating).toBeNull()
    expect(ctx!.message).toBeNull()
    expect(evaluateCondition({ field: 'conversation.team', op: 'is_empty' }, ctx!)).toBe(true)

    expect(await resolveConditionContext(createId('conversation') as ConversationId)).toBeNull()
  })

  it('evaluates the workspace settings-blob office hours at the snapshot instant', async () => {
    const principalId = await seedPrincipal()
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()
    // Mon 09:00-17:00 UTC. 2026-01-05 is a Monday.
    workspaceHours.schedule = {
      enabled: true,
      timezone: 'UTC',
      intervals: [{ day: 1, start: '09:00', end: '17:00' }],
    }
    const inside = await resolveConditionContext(conv.id, { at: new Date('2026-01-05T10:00:00Z') })
    expect(inside!.officeHours).toBe(true)
    const outside = await resolveConditionContext(conv.id, { at: new Date('2026-01-05T20:00:00Z') })
    expect(outside!.officeHours).toBe(false)
  })

  it("resolves an identified visitor's own attributes and email for person.attr.<key> / person.email", async () => {
    const principalId = await seedPrincipal({
      email: `ana-${suffix()}@example.com`,
      metadata: { plan: 'enterprise', seats: 25 },
    })
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.person!.attributes).toEqual({ plan: 'enterprise', seats: 25 })
    expect(ctx!.person!.email).toMatch(/^ana-.*@example\.com$/)
    expect(ctx!.company).toBeNull()

    expect(
      evaluateCondition({ field: 'person.attr.plan', op: 'eq', value: 'enterprise' }, ctx!)
    ).toBe(true)
    expect(evaluateCondition({ field: 'person.attr.seats', op: 'gt', value: 10 }, ctx!)).toBe(true)
    expect(
      evaluateCondition({ field: 'person.email', op: 'contains', value: '@example.com' }, ctx!)
    ).toBe(true)
  })

  it("resolves the visitor's first-class country / locale / plan columns for person.country / person.locale / person.plan", async () => {
    const principalId = await seedPrincipal({
      metadata: { plan: 'enterprise', seats: 25 },
      country: 'DE',
      locale: 'de-DE',
    })
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.person!.country).toBe('DE')
    expect(ctx!.person!.locale).toBe('de-DE')
    // person.plan reads the same user.metadata `plan` key the segment
    // evaluator's own `plan` attribute does — one plan vocabulary workspace-wide.
    expect(ctx!.person!.plan).toBe('enterprise')

    expect(evaluateCondition({ field: 'person.country', op: 'eq', value: 'DE' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.locale', op: 'eq', value: 'de-DE' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.plan', op: 'eq', value: 'enterprise' }, ctx!)).toBe(
      true
    )
    expect(evaluateCondition({ field: 'person.plan', op: 'neq', value: 'free' }, ctx!)).toBe(true)
  })

  it("resolves the visitor's linked company's attributes for company.attr.<key>", async () => {
    const [company] = await testDb
      .insert(companies)
      .values({
        name: `Acme-${suffix()}`,
        plan: 'pro',
        customAttributes: { tier: 'gold', arr: 120000 },
      })
      .returning()
    const principalId = await seedPrincipal({ companyId: company!.id })
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.company!.attributes).toEqual({ tier: 'gold', arr: 120000 })
    expect(evaluateCondition({ field: 'company.attr.tier', op: 'eq', value: 'gold' }, ctx!)).toBe(
      true
    )
    expect(evaluateCondition({ field: 'company.attr.arr', op: 'gte', value: 100000 }, ctx!)).toBe(
      true
    )
  })

  it('resolves every person/company attribute field as unresolved (undefined) for an anonymous visitor', async () => {
    const principalId = await seedAnonymousPrincipal()
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.person!.attributes).toEqual({})
    expect(ctx!.person!.email).toBeNull()
    expect(ctx!.person!.country).toBeNull()
    expect(ctx!.person!.locale).toBeNull()
    expect(ctx!.person!.plan).toBeNull()
    expect(ctx!.company).toBeNull()

    // The unresolved-subject contract: only is_empty matches.
    expect(evaluateCondition({ field: 'person.attr.plan', op: 'is_empty' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.attr.plan', op: 'is_set' }, ctx!)).toBe(false)
    expect(evaluateCondition({ field: 'company.attr.tier', op: 'is_empty' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.email', op: 'is_empty' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.email', op: 'is_set' }, ctx!)).toBe(false)
    expect(evaluateCondition({ field: 'person.country', op: 'is_empty' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.country', op: 'eq', value: 'DE' }, ctx!)).toBe(false)
    expect(evaluateCondition({ field: 'person.locale', op: 'is_empty' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.plan', op: 'is_empty' }, ctx!)).toBe(true)
    expect(evaluateCondition({ field: 'person.plan', op: 'neq', value: 'free' }, ctx!)).toBe(false)
  })

  it('resolvePersonCompany: false skips the person/company join entirely — the snapshot reads unresolved even though the DB has real values', async () => {
    const principalId = await seedPrincipal({
      email: `gated-${suffix()}@example.com`,
      metadata: { plan: 'enterprise' },
    })
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const ctx = await resolveConditionContext(conv.id, { resolvePersonCompany: false })
    expect(ctx!.person!.email).toBeNull()
    expect(ctx!.person!.country).toBeNull()
    expect(ctx!.person!.locale).toBeNull()
    expect(ctx!.person!.plan).toBeNull()
    expect(ctx!.person!.attributes).toEqual({})
    expect(ctx!.company).toBeNull()
    // person.segments is a separate, unconditional resolution — unaffected.
    expect(ctx!.person!.segmentIds).toEqual([])
  })

  it("resolves the paired customer ticket's type for ticket.type", async () => {
    const principalId = await seedPrincipal()
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()
    const ticketTypeId = await seedTicketType('Bug')
    await seedCustomerTicket(conv.id, ticketTypeId)

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.ticket).toEqual({ typeId: ticketTypeId })
    expect(evaluateCondition({ field: 'ticket.type', op: 'eq', value: ticketTypeId }, ctx!)).toBe(
      true
    )
    expect(
      evaluateCondition({ field: 'ticket.type', op: 'eq', value: createId('ticket_type') }, ctx!)
    ).toBe(false)
  })

  it('leaves ticket unresolved for a conversation with no customer ticket, and for a ticket predating the type registry', async () => {
    const principalId = await seedPrincipal()
    const [bare] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const bareCtx = await resolveConditionContext(bare.id)
    expect(bareCtx!.ticket).toBeNull()
    expect(evaluateCondition({ field: 'ticket.type', op: 'is_empty' }, bareCtx!)).toBe(true)
    expect(evaluateCondition({ field: 'ticket.type', op: 'is_set' }, bareCtx!)).toBe(false)

    const [typed] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()
    await seedCustomerTicket(typed.id, null)

    const untypedCtx = await resolveConditionContext(typed.id)
    expect(untypedCtx!.ticket).toEqual({ typeId: null })
    expect(evaluateCondition({ field: 'ticket.type', op: 'is_empty' }, untypedCtx!)).toBe(true)
  })

  it('resolveTicket: false skips the ticket lookup entirely — ticket.type reads unresolved even though the pair exists', async () => {
    const principalId = await seedPrincipal()
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()
    const ticketTypeId = await seedTicketType('Question')
    await seedCustomerTicket(conv.id, ticketTypeId)

    const ctx = await resolveConditionContext(conv.id, { resolveTicket: false })
    expect(ctx!.ticket).toBeNull()
    expect(evaluateCondition({ field: 'ticket.type', op: 'eq', value: ticketTypeId }, ctx!)).toBe(
      false
    )
  })

  it('sanitizes the synthetic anonymous placeholder email — person.email resolves MISSING, never the placeholder', async () => {
    const principalId = await seedPrincipal({
      email: `temp-${suffix()}@${ANON_EMAIL_DOMAIN}`,
      metadata: { plan: 'starter' },
    })
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'messenger' })
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.person!.email).toBeNull()
    // Attributes on the same (synthetic-email) row are unaffected — only the
    // email is sanitized.
    expect(ctx!.person!.attributes).toEqual({ plan: 'starter' })
    expect(evaluateCondition({ field: 'person.email', op: 'is_set' }, ctx!)).toBe(false)
    expect(evaluateCondition({ field: 'person.email', op: 'is_empty' }, ctx!)).toBe(true)
  })
})
