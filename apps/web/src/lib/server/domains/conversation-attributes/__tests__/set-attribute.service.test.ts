/**
 * Real-DB coverage for the ONE attribute write path all sources share:
 * definition-validated typed values, { v, src, at } envelopes, null-unset,
 * the AI precedence rule (AI never overwrites teammate/workflow/legacy
 * values, only its own), and the conversation/ticket dual target.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, TicketId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationAttributeDefinitions,
  conversations,
  tickets,
  ticketStatuses,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { setConversationAttribute } from '../set-attribute.service'
import {
  createConversationAttribute,
  archiveConversationAttribute,
} from '../conversation-attribute.service'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: conversationAttributeDefinitions.id })
      .from(conversationAttributeDefinitions)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedConversation(initial: Record<string, unknown> = {}): Promise<ConversationId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'messenger', customAttributes: initial })
    .returning()
  return conversation.id
}

async function seedTicket(): Promise<TicketId> {
  const [status] = await testDb
    .insert(ticketStatuses)
    .values({ name: 'Open', slug: `open-${suffix()}` })
    .returning()
  const [ticket] = await testDb
    .insert(tickets)
    .values({ title: 'Test ticket', statusId: status.id })
    .returning()
  return ticket.id
}

async function conversationAttributes(id: ConversationId): Promise<Record<string, unknown>> {
  const [row] = await testDb
    .select({ customAttributes: conversations.customAttributes })
    .from(conversations)
    .where(eq(conversations.id, id))
  return row.customAttributes
}

describe.skipIf(!fixture.available)('setConversationAttribute (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('writes a { v, src, at } envelope and preserves sibling keys', async () => {
    await createConversationAttribute({ key: 'plan', label: 'Plan', fieldType: 'text' })
    const conversationId = await seedConversation({ legacy_note: 'keep me' })

    await setConversationAttribute({ conversationId }, 'plan', 'pro', 'teammate')

    const attrs = await conversationAttributes(conversationId)
    expect(attrs.legacy_note).toBe('keep me')
    const stored = attrs.plan as { v: unknown; src: string; at: string }
    expect(stored.v).toBe('pro')
    expect(stored.src).toBe('teammate')
    expect(Number.isNaN(Date.parse(stored.at))).toBe(false)
  })

  it('validates values against the definition type', async () => {
    await createConversationAttribute({ key: 'seats', label: 'Seats', fieldType: 'number' })
    await createConversationAttribute({ key: 'vip', label: 'VIP', fieldType: 'checkbox' })
    await createConversationAttribute({ key: 'renewal', label: 'Renewal', fieldType: 'date' })
    const conversationId = await seedConversation()

    await expect(
      setConversationAttribute({ conversationId }, 'seats', 'not-a-number', 'teammate')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      setConversationAttribute({ conversationId }, 'vip', 'yes', 'teammate')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      setConversationAttribute({ conversationId }, 'renewal', 'not a date', 'teammate')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await setConversationAttribute({ conversationId }, 'seats', 12, 'teammate')
    await setConversationAttribute({ conversationId }, 'vip', true, 'teammate')
    await setConversationAttribute({ conversationId }, 'renewal', '2026-09-01', 'teammate')
    const attrs = await conversationAttributes(conversationId)
    expect(readAttributeValue(attrs.seats)?.v).toBe(12)
    expect(readAttributeValue(attrs.vip)?.v).toBe(true)
    expect(readAttributeValue(attrs.renewal)?.v).toBe('2026-09-01')
  })

  it('stores option IDS for select/multi_select and rejects unknown options', async () => {
    const def = await createConversationAttribute({
      key: 'severity',
      label: 'Severity',
      fieldType: 'select',
      options: [{ label: 'Low' }, { label: 'High' }],
    })
    await createConversationAttribute({
      key: 'areas',
      label: 'Areas',
      fieldType: 'multi_select',
      options: [{ label: 'Billing' }, { label: 'Auth' }],
    })
    const [low] = def.options!
    const conversationId = await seedConversation()

    await setConversationAttribute({ conversationId }, 'severity', low.id, 'teammate')
    await expect(
      setConversationAttribute({ conversationId }, 'severity', 'Low', 'teammate')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      setConversationAttribute({ conversationId }, 'areas', [low.id], 'teammate')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    const attrs = await conversationAttributes(conversationId)
    expect(readAttributeValue(attrs.severity)?.v).toBe(low.id)
  })

  it('unsets on null and rejects unknown or archived definitions', async () => {
    const def = await createConversationAttribute({ key: 'plan', label: 'Plan', fieldType: 'text' })
    const conversationId = await seedConversation()

    await setConversationAttribute({ conversationId }, 'plan', 'pro', 'teammate')
    await setConversationAttribute({ conversationId }, 'plan', null, 'teammate')
    expect('plan' in (await conversationAttributes(conversationId))).toBe(false)

    await expect(
      setConversationAttribute({ conversationId }, 'nope', 'x', 'teammate')
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_NOT_FOUND' })

    await archiveConversationAttribute(def.id)
    await expect(
      setConversationAttribute({ conversationId }, 'plan', 'pro', 'teammate')
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_ARCHIVED' })
  })

  it('never lets AI overwrite teammate/workflow/legacy values, only its own', async () => {
    await createConversationAttribute({ key: 'plan', label: 'Plan', fieldType: 'text' })
    const conversationId = await seedConversation()

    // AI fills an empty slot, then may revise its own verdict.
    await setConversationAttribute({ conversationId }, 'plan', 'starter', 'ai')
    await setConversationAttribute({ conversationId }, 'plan', 'growth', 'ai')
    let read = readAttributeValue((await conversationAttributes(conversationId)).plan)
    expect(read).toMatchObject({ v: 'growth', src: 'ai' })

    // A teammate takes over; AI must silently stand down.
    await setConversationAttribute({ conversationId }, 'plan', 'pro', 'teammate')
    await setConversationAttribute({ conversationId }, 'plan', 'ai-says-otherwise', 'ai')
    read = readAttributeValue((await conversationAttributes(conversationId)).plan)
    expect(read).toMatchObject({ v: 'pro', src: 'teammate' })

    // Workflow-set values are protected the same way.
    await setConversationAttribute({ conversationId }, 'plan', 'wf', 'workflow')
    await setConversationAttribute({ conversationId }, 'plan', 'ai-again', 'ai')
    read = readAttributeValue((await conversationAttributes(conversationId)).plan)
    expect(read).toMatchObject({ v: 'wf', src: 'workflow' })

    // A bare legacy value has unknown provenance: AI must not clobber it.
    const legacyConversation = await seedConversation({ plan: 'legacy' })
    await setConversationAttribute({ conversationId: legacyConversation }, 'plan', 'ai-take', 'ai')
    expect((await conversationAttributes(legacyConversation)).plan).toBe('legacy')
  })

  it('lets a customer fill an empty slot or one only AI has touched, but refuses to overwrite teammate/workflow/legacy values', async () => {
    await createConversationAttribute({ key: 'plan', label: 'Plan', fieldType: 'text' })

    // Empty slot: the customer may fill it.
    const emptyConversation = await seedConversation()
    await setConversationAttribute({ conversationId: emptyConversation }, 'plan', 'pro', 'customer')
    expect(
      readAttributeValue((await conversationAttributes(emptyConversation)).plan)
    ).toMatchObject({ v: 'pro', src: 'customer' })

    // AI-only slot: the customer may overwrite AI's own guess.
    const aiConversation = await seedConversation()
    await setConversationAttribute({ conversationId: aiConversation }, 'plan', 'starter', 'ai')
    await setConversationAttribute({ conversationId: aiConversation }, 'plan', 'growth', 'customer')
    expect(readAttributeValue((await conversationAttributes(aiConversation)).plan)).toMatchObject({
      v: 'growth',
      src: 'customer',
    })

    // Teammate-set slot: the customer is refused, visibly (not a silent no-op).
    const teammateConversation = await seedConversation()
    await setConversationAttribute(
      { conversationId: teammateConversation },
      'plan',
      'pro',
      'teammate'
    )
    await expect(
      setConversationAttribute(
        { conversationId: teammateConversation },
        'plan',
        'other',
        'customer'
      )
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_LOCKED' })
    expect(
      readAttributeValue((await conversationAttributes(teammateConversation)).plan)
    ).toMatchObject({ v: 'pro', src: 'teammate' })

    // Workflow-set slot: same refusal.
    const workflowConversation = await seedConversation()
    await setConversationAttribute(
      { conversationId: workflowConversation },
      'plan',
      'wf',
      'workflow'
    )
    await expect(
      setConversationAttribute(
        { conversationId: workflowConversation },
        'plan',
        'other',
        'customer'
      )
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_LOCKED' })

    // A customer's own prior write also can't be silently re-clobbered by a
    // second customer submission (write-once, not last-write-wins).
    const customerConversation = await seedConversation()
    await setConversationAttribute(
      { conversationId: customerConversation },
      'plan',
      'pro',
      'customer'
    )
    await expect(
      setConversationAttribute(
        { conversationId: customerConversation },
        'plan',
        'other',
        'customer'
      )
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_LOCKED' })

    // Bare legacy value (unknown provenance): the customer is refused too.
    const legacyConversation = await seedConversation({ plan: 'legacy' })
    await expect(
      setConversationAttribute({ conversationId: legacyConversation }, 'plan', 'other', 'customer')
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_LOCKED' })
  })

  it('writes to a ticket target through the same path', async () => {
    await createConversationAttribute({ key: 'plan', label: 'Plan', fieldType: 'text' })
    const ticketId = await seedTicket()

    await setConversationAttribute({ ticketId }, 'plan', 'enterprise', 'workflow')

    const [row] = await testDb
      .select({ customAttributes: tickets.customAttributes })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
    expect(readAttributeValue(row.customAttributes.plan)).toMatchObject({
      v: 'enterprise',
      src: 'workflow',
    })
  })
})
