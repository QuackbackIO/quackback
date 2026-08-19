/**
 * `suggestTicketFieldValuesFn` (convergence Phase 5): the create-ticket
 * dialog's auto-fill entry point. Covers the gate order (ticket.create ->
 * conversation viewable -> the suggestion service), the zod boundary, and the
 * pass-through of BOTH service outcomes (`unavailable` is a result, never a
 * throw). createServerFn is stubbed to a directly-callable fn (mirrors
 * copilot-summary.test.ts) so the real zod validator runs on each call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId, type ConversationId, type TicketTypeId } from '@quackback/ids'
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
  assertConversationViewable: vi.fn(),
  suggestTicketFieldValues: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: hoisted.assertConversationViewable,
}))
vi.mock('@/lib/server/domains/assistant/ticket-field-suggestion.service', () => ({
  suggestTicketFieldValues: hoisted.suggestTicketFieldValues,
}))

import { suggestTicketFieldValuesFn } from '../tickets'

const CONVERSATION_ID = createId('conversation') as ConversationId
const TICKET_TYPE_ID = createId('ticket_type') as TicketTypeId

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.policyActorFromAuth.mockResolvedValue({ type: 'user', principalId: 'principal_admin' })
  hoisted.assertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  hoisted.suggestTicketFieldValues.mockResolvedValue({
    suggestions: { title: 'CSV export drops filter columns', severity: 'High' },
  })
})

describe('suggestTicketFieldValuesFn', () => {
  it('gates on ticket.create — the same permission the dialog create path uses', async () => {
    await suggestTicketFieldValuesFn({
      data: { conversationId: CONVERSATION_ID, ticketTypeId: TICKET_TYPE_ID },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.TICKET_CREATE })
  })

  it('checks the conversation is viewable before grounding on its thread', async () => {
    await suggestTicketFieldValuesFn({
      data: { conversationId: CONVERSATION_ID, ticketTypeId: TICKET_TYPE_ID },
    })
    const actor = await hoisted.policyActorFromAuth.mock.results[0].value
    expect(hoisted.assertConversationViewable).toHaveBeenCalledWith(CONVERSATION_ID, actor)
  })

  it('returns the suggestion set on success', async () => {
    const result = await suggestTicketFieldValuesFn({
      data: { conversationId: CONVERSATION_ID, ticketTypeId: TICKET_TYPE_ID },
    })
    expect(result).toEqual({
      suggestions: { title: 'CSV export drops filter columns', severity: 'High' },
    })
    expect(hoisted.suggestTicketFieldValues).toHaveBeenCalledWith(CONVERSATION_ID, TICKET_TYPE_ID)
  })

  it('passes `unavailable` through as a result, never a throw (the quiet fallback)', async () => {
    hoisted.suggestTicketFieldValues.mockResolvedValue({ unavailable: true })
    const result = await suggestTicketFieldValuesFn({
      data: { conversationId: CONVERSATION_ID, ticketTypeId: TICKET_TYPE_ID },
    })
    expect(result).toEqual({ unavailable: true })
  })

  it('rejects an invalid conversation id at the boundary, before touching auth', async () => {
    await expect(
      suggestTicketFieldValuesFn({
        data: { conversationId: 'not-a-real-id', ticketTypeId: TICKET_TYPE_ID },
      })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('rejects an invalid ticket type id at the boundary', async () => {
    await expect(
      suggestTicketFieldValuesFn({
        data: { conversationId: CONVERSATION_ID, ticketTypeId: 'not-a-real-id' },
      })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('propagates an auth rejection without viewing or suggesting', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(
      suggestTicketFieldValuesFn({
        data: { conversationId: CONVERSATION_ID, ticketTypeId: TICKET_TYPE_ID },
      })
    ).rejects.toThrow('Access denied')
    expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
    expect(hoisted.suggestTicketFieldValues).not.toHaveBeenCalled()
  })

  it('propagates a viewability denial without suggesting', async () => {
    hoisted.assertConversationViewable.mockRejectedValue(new Error('Conversation not found'))
    await expect(
      suggestTicketFieldValuesFn({
        data: { conversationId: CONVERSATION_ID, ticketTypeId: TICKET_TYPE_ID },
      })
    ).rejects.toThrow('Conversation not found')
    expect(hoisted.suggestTicketFieldValues).not.toHaveBeenCalled()
  })
})
