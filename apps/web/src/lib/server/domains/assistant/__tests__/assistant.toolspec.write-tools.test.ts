/**
 * The four write-risk tool specs (set_attribute, end_conversation,
 * create_ticket, capture_feedback): zod input bounds, spec shape (risk/modes/
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

const mockSetConversationStatus = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  setConversationStatus: (...args: unknown[]) => mockSetConversationStatus(...args),
}))

const mockCreateTicket = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: (...args: unknown[]) => mockCreateTicket(...args),
}))

const mockCreatePostFromConversation = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.convert', () => ({
  createPostFromConversation: (...args: unknown[]) => mockCreatePostFromConversation(...args),
}))

import { ASSISTANT_TOOL_SPECS } from '../assistant.toolspec'
import { makeToolTestContext } from './assistant-tool-fixtures'

const ctx = makeToolTestContext

/** A fake db that resolves `select().from().where().limit()` to one row. */
function fakeDbReturning(row: Record<string, unknown> | undefined) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('set_attribute', () => {
  const spec = ASSISTANT_TOOL_SPECS.set_attribute

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.supportedModes).toEqual(['disabled', 'approval', 'autonomous'])
    expect(spec.defaultMode).toBe('autonomous')
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_SET_ATTRIBUTES])
  })

  it('is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn', () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('summarizes with the attribute key', () => {
    expect(spec.summarize({ key: 'plan_tier', value: 'pro' })).toBe('Set attribute "plan_tier"')
  })

  it('rejects a key over 100 characters', () => {
    const result = spec.definition.inputSchema.safeParse({ key: 'a'.repeat(101), value: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty key', () => {
    const result = spec.definition.inputSchema.safeParse({ key: '', value: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects an array value', () => {
    const result = spec.definition.inputSchema.safeParse({ key: 'k', value: ['x'] })
    expect(result.success).toBe(false)
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
})

describe('end_conversation', () => {
  const spec = ASSISTANT_TOOL_SPECS.end_conversation

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.supportedModes).toEqual(['disabled', 'approval', 'autonomous'])
    expect(spec.defaultMode).toBe('approval')
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
    expect(mockSetConversationStatus).not.toHaveBeenCalled()
  })

  it('closes the conversation on the happy path', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbReturning({ status: 'open' }) as never,
    })
    const out = await spec.execute({ reason: 'resolved' }, c)
    expect(mockSetConversationStatus).toHaveBeenCalledWith(
      'conversation_1',
      'closed',
      expect.objectContaining({ principalType: 'service' })
    )
    expect(out).toEqual({ closed: true })
  })

  it('is graceful when the conversation is already closed, without calling the service', async () => {
    const c = ctx({
      conversationId: 'conversation_1' as never,
      db: fakeDbReturning({ status: 'closed' }) as never,
    })
    const out = await spec.execute({}, c)
    expect(out).toEqual({ closed: true, note: 'Conversation was already closed.' })
    expect(mockSetConversationStatus).not.toHaveBeenCalled()
  })
})

describe('create_ticket', () => {
  const spec = ASSISTANT_TOOL_SPECS.create_ticket

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.supportedModes).toEqual(['disabled', 'approval', 'autonomous'])
    expect(spec.defaultMode).toBe('approval')
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
      db: fakeDbReturning({ visitorPrincipalId: 'principal_visitor' }) as never,
    })
    const out = await spec.execute({ type: 'customer', title: 'Cannot log in' }, c)
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'customer',
        title: 'Cannot log in',
        requesterPrincipalId: 'principal_visitor',
      }),
      expect.objectContaining({ principalType: 'service' })
    )
    expect(out).toEqual({
      created: true,
      ticketId: 'ticket_1',
      reference: 'T-42',
      title: 'Cannot log in',
    })
  })
})

describe('capture_feedback', () => {
  const spec = ASSISTANT_TOOL_SPECS.capture_feedback

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.defaultMode).toBe('approval')
    expect(spec.permissions).toEqual([PERMISSIONS.POST_CREATE, PERMISSIONS.POST_VOTE_ON_BEHALF])
  })

  it('is conversation-only (unified inbox §2.9): never offered on a ticket-scoped turn', () => {
    expect(spec.parents).toEqual(['conversation'])
  })

  it('never supports autonomous mode', () => {
    expect(spec.supportedModes).toEqual(['disabled', 'approval'])
    expect(spec.supportedModes).not.toContain('autonomous')
  })

  it('summarizes with the post title', () => {
    expect(spec.summarize({ boardId: 'board_1', title: 'Add dark mode' })).toBe(
      'Capture feedback: "Add dark mode"'
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
    const out = await spec.execute({ boardId: 'board_1', title: 'Add dark mode' }, ctx())
    expect(out).toEqual({ created: false, note: 'No linked conversation.' })
    expect(mockCreatePostFromConversation).not.toHaveBeenCalled()
  })

  it('creates the post attributed to Quinn as agent on the happy path', async () => {
    mockCreatePostFromConversation.mockResolvedValue({
      postId: 'post_1',
      created: true,
      boardSlug: 'feature-requests',
    })
    const c = ctx({
      conversationId: 'conversation_1' as never,
      assistantPrincipalId: 'principal_assistant' as never,
    })
    const out = await spec.execute({ boardId: 'board_1', title: 'Add dark mode' }, c)
    expect(mockCreatePostFromConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation_1',
        boardId: 'board_1',
        title: 'Add dark mode',
      }),
      expect.objectContaining({
        agentPrincipalId: 'principal_assistant',
        agent: expect.objectContaining({
          principalId: 'principal_assistant',
          displayName: 'Quinn',
        }),
      })
    )
    expect(out).toEqual({ created: true, postId: 'post_1' })
  })
})
