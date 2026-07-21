/**
 * `recordCopilotEventFn` (Quinn Copilot outcome loop): the panel's
 * fire-and-forget usage-event writer. Covers the gate order (copilot.use ->
 * inboxAi flag -> assistant configured -> item viewable, via the
 * shared `gateCopilotFn` — exercised for real over these mocked seams, not
 * mocked as a module), the shape rules (feedback requires a
 * rating and rejects a destination; every *_inserted kind requires a
 * destination and rejects a rating), and the exact assistant_events row shape
 * — destination/rating/reason/answerType/internalSourced land in metadata,
 * item + actor in their own columns. createServerFn is stubbed to a directly-callable fn
 * so the real zod validator runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId, type ConversationId, type TicketId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  isFeatureEnabled: vi.fn(),
  isAssistantConfigured: vi.fn(),
  assertConversationViewable: vi.fn(),
  assertTicketVisible: vi.fn(),
  insertValues: vi.fn(),
  insert: vi.fn(),
  assistantEvents: { __table: 'assistant_events' },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: hoisted.isFeatureEnabled,
}))
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: hoisted.isAssistantConfigured,
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: hoisted.assertConversationViewable,
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: hoisted.assertTicketVisible,
}))
vi.mock('@/lib/server/db', () => ({
  db: { insert: hoisted.insert },
  assistantEvents: hoisted.assistantEvents,
}))

import { recordCopilotEventFn } from '../copilot-events'

const CONVERSATION_ID = createId('conversation') as ConversationId
const TICKET_ID = createId('ticket') as TicketId
const PRINCIPAL_ID = 'principal_admin'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: PRINCIPAL_ID } })
  hoisted.policyActorFromAuth.mockResolvedValue({ type: 'user', principalId: PRINCIPAL_ID })
  hoisted.isFeatureEnabled.mockResolvedValue(true)
  hoisted.isAssistantConfigured.mockReturnValue(true)
  hoisted.assertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  hoisted.assertTicketVisible.mockResolvedValue({ id: TICKET_ID })
  hoisted.insertValues.mockResolvedValue(undefined)
  hoisted.insert.mockReturnValue({ values: hoisted.insertValues })
})

function insertedRow(): Record<string, unknown> {
  expect(hoisted.insert).toHaveBeenCalledWith(hoisted.assistantEvents)
  return hoisted.insertValues.mock.calls[0][0] as Record<string, unknown>
}

describe('recordCopilotEventFn', () => {
  it('gates on copilot.use, then the inboxAi flag', async () => {
    await recordCopilotEventFn({
      data: {
        item: { conversationId: CONVERSATION_ID },
        eventType: 'answer_inserted',
        destination: 'reply',
      },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.COPILOT_USE })
    expect(hoisted.isFeatureEnabled).toHaveBeenCalledWith('inboxAi')
  })

  it('rejects when the inboxAi flag is off, writing nothing', async () => {
    hoisted.isFeatureEnabled.mockResolvedValue(false)
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'answer_inserted',
          destination: 'reply',
        },
      })
    ).rejects.toThrow()
    expect(hoisted.insert).not.toHaveBeenCalled()
  })

  it('rejects when the assistant is not configured, writing nothing', async () => {
    hoisted.isAssistantConfigured.mockReturnValue(false)
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'answer_inserted',
          destination: 'reply',
        },
      })
    ).rejects.toThrow()
    expect(hoisted.insert).not.toHaveBeenCalled()
  })

  it('checks conversation viewability for a conversation-scoped event', async () => {
    await recordCopilotEventFn({
      data: {
        item: { conversationId: CONVERSATION_ID },
        eventType: 'answer_inserted',
        destination: 'reply',
      },
    })
    expect(hoisted.assertConversationViewable).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.anything()
    )
    expect(hoisted.assertTicketVisible).not.toHaveBeenCalled()
  })

  it('checks ticket visibility for a ticket-scoped event', async () => {
    await recordCopilotEventFn({
      data: { item: { ticketId: TICKET_ID }, eventType: 'answer_inserted', destination: 'note' },
    })
    expect(hoisted.assertTicketVisible).toHaveBeenCalledWith(TICKET_ID, expect.anything())
    expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
  })

  it('rejects (and writes nothing) when the item is not viewable', async () => {
    hoisted.assertConversationViewable.mockRejectedValue(new Error('Conversation not found'))
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'answer_inserted',
          destination: 'reply',
        },
      })
    ).rejects.toThrow('Conversation not found')
    expect(hoisted.insert).not.toHaveBeenCalled()
  })

  it('writes one row attributing the event to the acting teammate and item', async () => {
    await recordCopilotEventFn({
      data: {
        item: { conversationId: CONVERSATION_ID },
        eventType: 'answer_inserted',
        destination: 'reply',
        answerType: 'draft_reply',
        internalSourced: true,
      },
    })
    expect(insertedRow()).toEqual({
      eventType: 'answer_inserted',
      principalId: PRINCIPAL_ID,
      conversationId: CONVERSATION_ID,
      ticketId: null,
      metadata: { destination: 'reply', answerType: 'draft_reply', internalSourced: true },
    })
  })

  it('writes ticket-scoped rows with conversationId null', async () => {
    await recordCopilotEventFn({
      data: { item: { ticketId: TICKET_ID }, eventType: 'summary_inserted', destination: 'note' },
    })
    expect(insertedRow()).toEqual({
      eventType: 'summary_inserted',
      principalId: PRINCIPAL_ID,
      conversationId: null,
      ticketId: TICKET_ID,
      metadata: { destination: 'note' },
    })
  })

  it('puts rating and reason in metadata for a feedback event', async () => {
    await recordCopilotEventFn({
      data: {
        item: { conversationId: CONVERSATION_ID },
        eventType: 'feedback',
        rating: 'down',
        reason: 'Cited the wrong article',
      },
    })
    expect(insertedRow()).toEqual({
      eventType: 'feedback',
      principalId: PRINCIPAL_ID,
      conversationId: CONVERSATION_ID,
      ticketId: null,
      metadata: { rating: 'down', reason: 'Cited the wrong article' },
    })
  })

  it('rejects a feedback event without a rating, before touching auth', async () => {
    await expect(
      recordCopilotEventFn({
        data: { item: { conversationId: CONVERSATION_ID }, eventType: 'feedback' },
      })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('rejects a non-feedback event carrying a rating, before touching auth', async () => {
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'answer_inserted',
          destination: 'reply',
          rating: 'up',
        },
      })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('rejects an inserted event without a destination, before touching auth', async () => {
    for (const eventType of [
      'answer_inserted',
      'transform_inserted',
      'summary_inserted',
    ] as const) {
      await expect(
        recordCopilotEventFn({
          data: { item: { conversationId: CONVERSATION_ID }, eventType },
        })
      ).rejects.toThrow()
    }
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('rejects a feedback event carrying a destination, before touching auth', async () => {
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'feedback',
          rating: 'up',
          // Deliberately off-contract: destination is the inserted kinds' axis.
          destination: 'reply' as never,
        },
      })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it("omitting internalSourced stores no key (an aborted turn's insert is never coerced to false)", async () => {
    await recordCopilotEventFn({
      data: {
        item: { conversationId: CONVERSATION_ID },
        eventType: 'answer_inserted',
        destination: 'reply',
      },
    })
    expect(insertedRow().metadata).toEqual({ destination: 'reply' })
  })

  it('rejects an unknown eventType at the boundary', async () => {
    await expect(
      recordCopilotEventFn({
        // Deliberately off-contract; cast past the compile-time enum.
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'answer_copied' as 'answer_inserted',
        },
      })
    ).rejects.toThrow()
    // 'note_inserted' left the vocabulary when destination became its own
    // axis — it must reject like any unknown type.
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'note_inserted' as 'answer_inserted',
          destination: 'note',
        },
      })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('rejects an item carrying both ids, or neither', async () => {
    await expect(
      recordCopilotEventFn({
        data: {
          // Deliberately off-contract; cast past the exactly-one union.
          item: { conversationId: CONVERSATION_ID, ticketId: TICKET_ID } as unknown as {
            conversationId: string
          },
          eventType: 'answer_inserted',
          destination: 'reply',
        },
      })
    ).rejects.toThrow()
    await expect(
      recordCopilotEventFn({
        data: {
          item: {} as unknown as { conversationId: string },
          eventType: 'answer_inserted',
          destination: 'reply',
        },
      })
    ).rejects.toThrow()
  })

  it('rejects a reason over 500 characters', async () => {
    await expect(
      recordCopilotEventFn({
        data: {
          item: { conversationId: CONVERSATION_ID },
          eventType: 'feedback',
          rating: 'down',
          reason: 'x'.repeat(501),
        },
      })
    ).rejects.toThrow()
  })
})
