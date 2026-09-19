/**
 * The write-risk tool specs (set_attribute, end_conversation, create_ticket,
 * capture_feedback, share_post): zod input bounds, spec shape (risk/modes/
 * permissions), summarize text, and the executors' no-conversation guard plus
 * one mocked happy path each. The control-mode pipeline itself (approval,
 * autonomous, idempotency, audit) is exercised against a fake spec in
 * assistant.tools.test.ts; this file only owns what assistant.toolspec.ts
 * defines.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/config', () => ({ config: {} }))

// assistant.toolspec.ts also pulls in retrieval + conversation.query for the
// read tools; mocked here too so importing the module never risks a real
// DB/embedding call, matching assistant.tools.test.ts's approach.
vi.mock('../retrieval', () => ({
  retrieveKbArticles: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: vi.fn(),
}))

const mockSetConversationAttribute = vi.fn()
vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute: (...args: unknown[]) => mockSetConversationAttribute(...args),
}))

const mockEndConversation = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  endConversation: (...args: unknown[]) => mockEndConversation(...args),
}))

const mockRecordOutcome = vi.fn()
vi.mock('../assistant.involvement', () => ({
  recordOutcome: (...args: unknown[]) => mockRecordOutcome(...args),
}))

const mockClassifyConversationAttributes = vi.fn()
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: (...args: unknown[]) =>
    mockClassifyConversationAttributes(...args),
}))

const mockCreateTicket = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: (...args: unknown[]) => mockCreateTicket(...args),
}))

const mockLinkTicketToConversation = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-conversation-link.service', () => ({
  linkTicketToConversation: (...args: unknown[]) => mockLinkTicketToConversation(...args),
}))

const mockCaptureInternalFeedback = vi.fn()
vi.mock('@/lib/server/domains/posts/post.capture', () => ({
  captureInternalFeedback: (...args: unknown[]) => mockCaptureInternalFeedback(...args),
}))

const mockCreatePostFromConversation = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.convert', () => ({
  createPostFromConversation: (...args: unknown[]) => mockCreatePostFromConversation(...args),
}))

// The embed-card sends are the message seams create_ticket (after a successful
// link) and share_post drive — mocked so no real conversation write runs.
const mockShareTicket = vi.fn()
const mockSharePost = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.cards', () => ({
  shareTicket: (...args: unknown[]) => mockShareTicket(...args),
  sharePost: (...args: unknown[]) => mockSharePost(...args),
}))

import { ASSISTANT_TOOL_SPECS, CAPTURE_FEEDBACK_CONTRACT_DIGEST } from '../assistant.toolspec'
import { makeToolTestContext } from './assistant-tool-fixtures'

const ctx = makeToolTestContext

/** A fake db that resolves `select().from().where().limit()` to one row. */
function fakeDbReturning(row: Record<string, unknown> | undefined) {
  return fakeDbSequence([row])
}

/** Each select() consumes the next queued row (undefined = empty result);
 *  supports the optional innerJoin step the ticket dup-check uses. */
function fakeDbSequence(rows: Array<Record<string, unknown> | undefined>) {
  const queue = [...rows]
  return {
    select: () => {
      const next = queue.shift()
      const tail = {
        where: () => ({ limit: () => Promise.resolve(next ? [next] : []) }),
      }
      return { from: () => ({ ...tail, innerJoin: () => tail }) }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockClassifyConversationAttributes.mockResolvedValue([])
})

describe('set_attribute', () => {
  const spec = ASSISTANT_TOOL_SPECS.set_attribute

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_SET_ATTRIBUTES])
  })

  it('is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn', () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('summarizes with the attribute key and value', () => {
    expect(spec.summarize({ key: 'plan_tier', value: 'pro' })).toBe('Set plan_tier to "pro"')
    expect(spec.summarize({ key: 'seats', value: 5 })).toBe('Set seats to 5')
    expect(spec.summarize({ key: 'tags', value: ['a', 'b'] })).toBe('Set tags to "a", "b"')
  })

  it('summarizes with the catalogue label and option labels when a context carries them', () => {
    const ctx = {
      attributeCatalogue: [
        {
          key: 'issue_type',
          label: 'Issue type',
          fieldType: 'select',
          options: [{ id: 'bug', label: 'Bug' }],
        },
        { key: 'notes', label: 'Notes', fieldType: 'text' },
      ],
    } as unknown as Parameters<typeof spec.summarize>[1]
    expect(spec.summarize({ key: 'issue_type', value: 'bug' }, ctx)).toBe('Set Issue type to Bug')
    // Unknown option id and key-less-of-catalogue fall back to raw rendering.
    expect(spec.summarize({ key: 'issue_type', value: 'other' }, ctx)).toBe(
      'Set Issue type to "other"'
    )
    expect(spec.summarize({ key: 'notes', value: null }, ctx)).toBe('Clear Notes')
  })

  it('rejects a key over 100 characters', () => {
    const result = spec.definition.inputSchema.safeParse({ key: 'a'.repeat(101), value: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty key', () => {
    const result = spec.definition.inputSchema.safeParse({ key: '', value: 'x' })
    expect(result.success).toBe(false)
  })

  it('accepts a string array (multi_select)', () => {
    const result = spec.definition.inputSchema.safeParse({ key: 'k', value: ['x', 'y'] })
    expect(result.success).toBe(true)
  })

  it('rejects an array of non-string values', () => {
    expect(spec.definition.inputSchema.safeParse({ key: 'k', value: [1, 2] }).success).toBe(false)
    expect(spec.definition.inputSchema.safeParse({ key: 'k', value: [true] }).success).toBe(false)
  })

  it('rejects an object value', () => {
    const result = spec.definition.inputSchema.safeParse({ key: 'k', value: { x: 1 } })
    expect(result.success).toBe(false)
  })

  it('accepts string, number, boolean, and null values', () => {
    for (const value of ['x', 1, true, null]) {
      expect(spec.definition.inputSchema.safeParse({ key: 'k', value }).success).toBe(true)
    }
  })

  it('reports no linked conversation without a conversationId', async () => {
    const out = await spec.execute({ key: 'k', value: 'v' }, ctx())
    expect(out).toEqual({ applied: false, note: 'No linked conversation.' })
    expect(mockSetConversationAttribute).not.toHaveBeenCalled()
  })

  it('applies the write on the happy path', async () => {
    mockSetConversationAttribute.mockResolvedValue({
      plan_tier: { v: 'pro', src: 'ai', at: '2026-01-01' },
    })
    const c = ctx({ conversationId: 'conversation_1' as never })
    const out = await spec.execute({ key: 'plan_tier', value: 'pro' }, c)
    expect(mockSetConversationAttribute).toHaveBeenCalledWith(
      { conversationId: 'conversation_1' },
      'plan_tier',
      'pro',
      'ai'
    )
    expect(out).toEqual({ applied: true })
  })

  it('reports the slot was already set by another source', async () => {
    mockSetConversationAttribute.mockResolvedValue({
      plan_tier: { v: 'enterprise', src: 'teammate', at: '2026-01-01' },
    })
    const c = ctx({ conversationId: 'conversation_1' as never })
    const out = await spec.execute({ key: 'plan_tier', value: 'pro' }, c)
    expect(out).toEqual({ applied: false, note: 'Attribute already set by another source.' })
  })

  it('treats a null value as applied once the key is cleared', async () => {
    mockSetConversationAttribute.mockResolvedValue({})
    const c = ctx({ conversationId: 'conversation_1' as never })
    const out = await spec.execute({ key: 'plan_tier', value: null }, c)
    expect(out).toEqual({ applied: true })
  })

  it('applies a multi_select array write on the happy path (order-insensitive)', async () => {
    mockSetConversationAttribute.mockResolvedValue({
      affected_features: { v: ['opt_b', 'opt_a'], src: 'ai', at: '2026-01-01' },
    })
    const c = ctx({ conversationId: 'conversation_1' as never })
    const out = await spec.execute({ key: 'affected_features', value: ['opt_a', 'opt_b'] }, c)
    expect(mockSetConversationAttribute).toHaveBeenCalledWith(
      { conversationId: 'conversation_1' },
      'affected_features',
      ['opt_a', 'opt_b'],
      'ai'
    )
    expect(out).toEqual({ applied: true })
  })

  it('reports a multi_select slot already set by another source', async () => {
    mockSetConversationAttribute.mockResolvedValue({
      affected_features: { v: ['opt_c'], src: 'teammate', at: '2026-01-01' },
    })
    const c = ctx({ conversationId: 'conversation_1' as never })
    const out = await spec.execute({ key: 'affected_features', value: ['opt_a'] }, c)
    expect(out).toEqual({ applied: false, note: 'Attribute already set by another source.' })
  })
})

describe('end_conversation', () => {
  const spec = ASSISTANT_TOOL_SPECS.end_conversation

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_SET_STATUS])
  })

  it('is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn', () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('summarizes as a fixed string regardless of the reason', () => {
    expect(spec.summarize({ reason: 'resolved' })).toBe('Close the conversation')
    expect(spec.summarize({})).toBe('Close the conversation')
  })

  it('rejects a reason over 200 characters', () => {
    const result = spec.definition.inputSchema.safeParse({ reason: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('accepts an omitted reason', () => {
    expect(spec.definition.inputSchema.safeParse({}).success).toBe(true)
  })

  it('reports no linked conversation without a conversationId', async () => {
    const out = await spec.execute({}, ctx())
    expect(out).toEqual({ closed: false, note: 'No linked conversation.' })
    expect(mockEndConversation).not.toHaveBeenCalled()
  })

  it('defers closure until the final reply has been persisted', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      involvementId: 'assistant_involvement_1' as never,
      db: fakeDbReturning({ status: 'open' }) as never,
    })
    const out = await spec.execute({ reason: 'resolved' }, c)
    expect(mockEndConversation).not.toHaveBeenCalled()
    expect(mockRecordOutcome).not.toHaveBeenCalled()
    expect(c.ledger.closeRequest).toEqual({ reason: 'resolved' })
    expect(out).toEqual({ closed: true })
  })

  it('is graceful when the conversation is already closed, without calling the service', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbReturning({ status: 'closed' }) as never,
    })
    const out = await spec.execute({}, c)
    expect(out).toEqual({ closed: true, note: 'Conversation was already closed.' })
    expect(mockEndConversation).not.toHaveBeenCalled()
    expect(mockRecordOutcome).not.toHaveBeenCalled()
  })

  it('defers close-time classification until persistence', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbReturning({ status: 'open' }) as never,
    })
    await spec.execute({ reason: 'resolved' }, c)
    expect(mockClassifyConversationAttributes).not.toHaveBeenCalled()
    expect(c.ledger.closeRequest).toEqual({ reason: 'resolved' })
  })

  it('does not classify again when the conversation was already closed', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbReturning({ status: 'closed' }) as never,
    })
    await spec.execute({}, c)
    expect(mockClassifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('never lets a classification failure block reporting the close as successful', async () => {
    mockClassifyConversationAttributes.mockRejectedValue(new Error('classifier exploded'))
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbReturning({ status: 'open' }) as never,
    })
    const out = await spec.execute({ reason: 'resolved' }, c)
    expect(out).toEqual({ closed: true })
  })
})

describe('create_ticket', () => {
  const spec = ASSISTANT_TOOL_SPECS.create_ticket

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.permissions).toEqual([PERMISSIONS.TICKET_CREATE])
  })

  it("is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn (it creates a NEW ticket from a conversation, unrelated to the turn's own ticket)", () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('summarizes with the ticket type and title', () => {
    expect(spec.summarize({ type: 'customer', title: 'Cannot log in' })).toBe(
      'Create a customer ticket: "Cannot log in"'
    )
  })

  it('rejects a title over 300 characters', () => {
    const result = spec.definition.inputSchema.safeParse({
      type: 'customer',
      title: 'a'.repeat(301),
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty title', () => {
    const result = spec.definition.inputSchema.safeParse({ type: 'customer', title: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown ticket type', () => {
    const result = spec.definition.inputSchema.safeParse({ type: 'bogus', title: 'x' })
    expect(result.success).toBe(false)
  })

  it('accepts the three known ticket types with an optional description and priority', () => {
    for (const type of ['customer', 'back_office', 'tracker']) {
      const result = spec.definition.inputSchema.safeParse({
        type,
        title: 'x',
        description: 'more detail',
        priority: 'high',
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects a description over 10000 characters', () => {
    const result = spec.definition.inputSchema.safeParse({
      type: 'customer',
      title: 'x',
      description: 'a'.repeat(10001),
    })
    expect(result.success).toBe(false)
  })

  it('reports no linked conversation without a conversationId', async () => {
    const out = await spec.execute({ type: 'customer', title: 'Cannot log in' }, ctx())
    expect(out).toEqual({ created: false, note: 'No linked conversation.' })
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('creates the ticket with the visitor as requester on the happy path', async () => {
    mockCreateTicket.mockResolvedValue({
      id: 'ticket_1',
      reference: 'T-42',
      title: 'Cannot log in',
    })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      // Snapshot lookup, then an EMPTY dup-check (no customer ticket linked yet).
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }, undefined]) as never,
    })
    const out = await spec.execute({ type: 'customer', title: 'Cannot log in' }, c)
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'customer',
        title: 'Cannot log in',
        requesterPrincipalId: 'principal_visitor',
        // The ticket originates from THIS conversation: createTicket must not
        // mint a synthetic backing conversation (#499).
        sourceConversationId: 'conversation_1',
      }),
      expect.objectContaining({ principalType: 'service' })
    )
    // Provenance: the customer ticket is tied back to its originating
    // conversation (join row + the thread announcement the link service owns).
    expect(mockLinkTicketToConversation).toHaveBeenCalledWith(
      'ticket_1',
      'conversation_1',
      expect.objectContaining({ principalType: 'service' })
    )
    expect(out).toEqual({
      created: true,
      ticketId: 'ticket_1',
      reference: 'T-42',
      title: 'Cannot log in',
    })
  })

  it('defaults an omitted type to customer (visible and trackable by the requester)', async () => {
    const parsed = spec.definition.inputSchema.parse({ title: 'Cannot log in' })
    expect(parsed.type).toBe('customer')

    mockCreateTicket.mockResolvedValue({ id: 'ticket_1', reference: 'T-42', title: 'x' })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }, undefined]) as never,
    })
    await spec.execute({ title: 'Cannot log in' } as never, c)
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer' }),
      expect.anything()
    )
  })

  it('back_office tickets skip the dup-check and are never conversation-linked', async () => {
    mockCreateTicket.mockResolvedValue({ id: 'ticket_2', reference: 'T-43', title: 'x' })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }]) as never,
    })
    const out = await spec.execute({ type: 'back_office', title: 'Investigate infra' }, c)
    expect(out).toMatchObject({ created: true })
    expect(mockLinkTicketToConversation).not.toHaveBeenCalled()
  })

  it('refuses a second customer ticket for the same conversation, naming the existing one', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      // Snapshot lookup, then the dup-check finds an existing linked ticket.
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }, { number: 42 }]) as never,
    })
    const out = (await spec.execute({ type: 'customer', title: 'Cannot log in' }, c)) as {
      created: boolean
      note?: string
    }
    expect(out.created).toBe(false)
    expect(out.note).toContain('already has ticket')
    expect(mockCreateTicket).not.toHaveBeenCalled()
    expect(mockLinkTicketToConversation).not.toHaveBeenCalled()
  })

  it('a lost race on the link (ConflictError) never turns the created ticket into a failure', async () => {
    const { ConflictError } = await import('@/lib/shared/errors')
    mockCreateTicket.mockResolvedValue({ id: 'ticket_1', reference: 'T-42', title: 'x' })
    mockLinkTicketToConversation.mockRejectedValue(
      new ConflictError('ALREADY_LINKED', 'This conversation already has a linked ticket')
    )
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }, undefined]) as never,
    })
    const out = await spec.execute({ type: 'customer', title: 'Cannot log in' }, c)
    expect(out).toMatchObject({ created: true, ticketId: 'ticket_1' })
    // A failed link means another ticket already owns the conversation — no card.
    expect(mockShareTicket).not.toHaveBeenCalled()
  })

  it('drops the live ticket card into the chat as Quinn after linking a customer ticket', async () => {
    mockLinkTicketToConversation.mockResolvedValue(undefined)
    mockCreateTicket.mockResolvedValue({
      id: 'ticket_1',
      reference: 'T-42',
      title: 'Cannot log in',
    })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }, undefined]) as never,
    })
    const out = await spec.execute({ type: 'customer', title: 'Cannot log in' }, c)
    expect(out).toMatchObject({ created: true, ticketId: 'ticket_1' })
    expect(mockShareTicket).toHaveBeenCalledWith(
      { conversationId: 'conversation_1', ticketId: 'ticket_1' },
      expect.objectContaining({
        agentPrincipalId: 'principal_assistant',
        agentActor: expect.objectContaining({ principalType: 'service' }),
        agent: expect.objectContaining({ principalId: 'principal_assistant' }),
      })
    )
  })

  it('never sends a ticket card for a back_office ticket', async () => {
    mockCreateTicket.mockResolvedValue({ id: 'ticket_2', reference: 'T-43', title: 'x' })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }]) as never,
    })
    await spec.execute({ type: 'back_office', title: 'Investigate infra' }, c)
    expect(mockShareTicket).not.toHaveBeenCalled()
  })

  it('a failed card send never turns the created ticket into a failure', async () => {
    mockLinkTicketToConversation.mockResolvedValue(undefined)
    mockCreateTicket.mockResolvedValue({ id: 'ticket_1', reference: 'T-42', title: 'x' })
    mockShareTicket.mockRejectedValue(new Error('broadcast down'))
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbSequence([{ visitorPrincipalId: 'principal_visitor' }, undefined]) as never,
    })
    const out = await spec.execute({ type: 'customer', title: 'Cannot log in' }, c)
    expect(out).toMatchObject({ created: true, ticketId: 'ticket_1' })
  })
})

describe('capture_feedback', () => {
  const spec = ASSISTANT_TOOL_SPECS.capture_feedback
  const CAPTURE_KEY = 'conversation_1:inv:x:capture_feedback:digest'

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    // No vote-on-behalf: an internal capture casts no vote.
    expect(spec.permissions).toEqual([PERMISSIONS.POST_CREATE])
  })

  it('declares a contract digest, so a proposal approved under the old card is refused', () => {
    // Built-ins normally carry none. This one does because its meaning moved
    // from "post this publicly" to "record this internally"; the executor
    // reads an absent stored digest against a declared one as a refusal.
    expect(spec.contractDigest).toBe(CAPTURE_FEEDBACK_CONTRACT_DIGEST)
  })

  it('describes an internal record, and says what it is not', () => {
    // The old contract told the model this posted publicly under the
    // customer's identity and joined the roadmap. Both are now false, and a
    // model reading a stale description would tell the customer so.
    const description = spec.definition.description.toLowerCase()
    expect(description).toContain('internal')
    expect(description).toContain('not a public post')
    expect(description).toContain('cannot see it')
    expect(description).not.toContain('joins the roadmap')
  })

  it('is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn', () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('summarizes with the request title', () => {
    expect(spec.summarize({ boardId: 'board_1', title: 'Add dark mode' })).toBe(
      'Record feedback for the product team: "Add dark mode"'
    )
  })

  it('rejects a title over 200 characters', () => {
    const result = spec.definition.inputSchema.safeParse({
      boardId: 'board_1',
      title: 'a'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('rejects content over 2000 characters', () => {
    const result = spec.definition.inputSchema.safeParse({
      boardId: 'board_1',
      title: 'x',
      content: 'a'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing boardId', () => {
    const result = spec.definition.inputSchema.safeParse({ title: 'x' })
    expect(result.success).toBe(false)
  })

  it('reports no linked conversation without a conversationId', async () => {
    const out = await spec.execute(
      { boardId: 'board_01h455vb4pex5vsknk084sn02q', title: 'Add dark mode' },
      ctx({ actionKey: CAPTURE_KEY })
    )
    expect(out).toEqual({ created: false, note: 'No linked conversation.' })
    expect(mockCaptureInternalFeedback).not.toHaveBeenCalled()
  })

  it('records the capture for the conversation customer, keyed by the receipt action key', async () => {
    mockCaptureInternalFeedback.mockResolvedValue({
      outcome: 'captured',
      postId: 'post_1',
      title: 'Add dark mode',
    })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
      involvementId: 'involvement_1' as never,
      actionKey: CAPTURE_KEY,
      db: fakeDbReturning({ status: 'open', visitorPrincipalId: 'principal_visitor' }) as never,
    })
    const boardId = 'board_01h455vb4pex5vsknk084sn02q'
    const out = await spec.execute({ boardId, title: 'Add dark mode' }, c)

    expect(mockCaptureInternalFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation_1',
        boardId,
        title: 'Add dark mode',
        captureKey: CAPTURE_KEY,
        kind: 'assistant',
        involvementId: 'involvement_1',
      }),
      expect.objectContaining({
        capturedByPrincipalId: 'principal_assistant',
        // The customer comes from the conversation row, never the arguments.
        customerPrincipalId: 'principal_visitor',
      })
    )
    expect(out).toMatchObject({ created: true, outcome: 'captured', postId: 'post_1' })
  })

  it('reports a repeat as already recorded rather than as a failure', async () => {
    mockCaptureInternalFeedback.mockResolvedValue({
      outcome: 'already_captured',
      postId: 'post_1',
      title: 'Add dark mode',
    })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
      actionKey: CAPTURE_KEY,
      db: fakeDbReturning({ status: 'open', visitorPrincipalId: 'principal_visitor' }) as never,
    })
    const out = await spec.execute(
      { boardId: 'board_01h455vb4pex5vsknk084sn02q', title: 'Add dark mode' },
      c
    )
    expect(out).toMatchObject({
      created: false,
      outcome: 'already_captured',
      postId: 'post_1',
    })
    expect((out as { note?: string }).note).toMatch(/already recorded/i)
  })

  it('refuses to capture without a stable identity to record it under', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
      db: fakeDbReturning({ status: 'open', visitorPrincipalId: 'principal_visitor' }) as never,
    })
    const out = await spec.execute(
      { boardId: 'board_01h455vb4pex5vsknk084sn02q', title: 'Add dark mode' },
      c
    )
    expect(out).toMatchObject({ created: false })
    expect(mockCaptureInternalFeedback).not.toHaveBeenCalled()
  })

  it('fails gracefully on a malformed board id instead of calling the service', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
      actionKey: CAPTURE_KEY,
    })
    const out = await spec.execute({ boardId: 'not-a-board-id', title: 'Add dark mode' }, c)
    expect(out).toEqual({ created: false, note: 'Unknown or invalid board id.' })
    expect(mockCaptureInternalFeedback).not.toHaveBeenCalled()
  })
})

describe('share_post', () => {
  const spec = ASSISTANT_TOOL_SPECS.share_post
  // A real, round-trip-valid post TypeID (isTypeId rejects structurally-bogus
  // suffixes, so 'post_1'-style shorthands would fail the format gate).
  const POST_ID = 'post_01ktjwt5tyf6br9mw521h13n6n'

  /** A context with the posts knowledge source on and `postId` in the ledger
   *  as a 'post' citation — the state a real search-then-share turn is in. */
  function ledgeredCtx(overrides: Parameters<typeof ctx>[0] = {}) {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
      knowledge: { sources: new Set(['article', 'post'] as const), status: false },
      ...overrides,
    })
    c.ledger.sources.set(POST_ID, {
      type: 'post',
      id: POST_ID,
      title: 'Dark mode',
      url: `/b/features/posts/${POST_ID}`,
    })
    return c
  }

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    // Sharing sends a customer-visible agent message; sendAgentMessage gates on
    // canActAsAgent → CONVERSATION_REPLY, so that is the permission checked.
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_REPLY])
  })

  it('is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn', () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('is registered only when the posts knowledge source is enabled this turn', () => {
    expect(spec.availableWhen).toBeDefined()
    expect(spec.availableWhen!(ctx())).toBe(false) // KB-only default
    expect(
      spec.availableWhen!(
        ctx({ knowledge: { sources: new Set(['article', 'post'] as const), status: false } })
      )
    ).toBe(true)
  })

  it('summarizes with the post id', () => {
    expect(spec.summarize({ postId: POST_ID })).toBe(`Share feedback post ${POST_ID}`)
  })

  it('rejects an empty postId', () => {
    expect(spec.definition.inputSchema.safeParse({ postId: '' }).success).toBe(false)
    expect(spec.definition.inputSchema.safeParse({}).success).toBe(false)
  })

  it('reports no linked conversation without a conversationId', async () => {
    const out = await spec.execute({ postId: POST_ID }, ctx())
    expect(out).toEqual({ shared: false, note: 'No linked conversation.' })
    expect(mockSharePost).not.toHaveBeenCalled()
  })

  it('fails gracefully on a malformed post id before consulting the ledger', async () => {
    const out = await spec.execute({ postId: 'not-a-post-id' }, ledgeredCtx())
    expect(out).toEqual({ shared: false, note: 'Unknown or invalid post id.' })
    expect(mockSharePost).not.toHaveBeenCalled()
  })

  it('refuses a valid post id the turn ledger never surfaced (hallucination guard)', async () => {
    const c = ledgeredCtx()
    c.ledger.sources.clear()
    const out = await spec.execute({ postId: POST_ID }, c)
    expect(out).toEqual({
      shared: false,
      note: "Only a post surfaced by this turn's search can be shared. Search first.",
    })
    expect(mockSharePost).not.toHaveBeenCalled()
  })

  it('refuses an id ledgered under a non-post citation type', async () => {
    const c = ledgeredCtx()
    c.ledger.sources.set(POST_ID, { type: 'article', id: POST_ID, title: 'x', url: '/x' })
    const out = await spec.execute({ postId: POST_ID }, c)
    expect(out).toMatchObject({ shared: false })
    expect(mockSharePost).not.toHaveBeenCalled()
  })

  it('shares a ledgered post as Quinn on the happy path', async () => {
    const out = await spec.execute({ postId: POST_ID }, ledgeredCtx())
    expect(mockSharePost).toHaveBeenCalledWith(
      { conversationId: 'conversation_1', postId: POST_ID },
      expect.objectContaining({
        agentPrincipalId: 'principal_assistant',
        agentActor: expect.objectContaining({ principalType: 'service' }),
        agent: expect.objectContaining({
          principalId: 'principal_assistant',
          displayName: 'Quinn',
        }),
      })
    )
    expect(out).toEqual({ shared: true, note: 'Shared "Dark mode" into the conversation.' })
  })
})
