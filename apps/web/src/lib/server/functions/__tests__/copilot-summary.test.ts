/**
 * `summarizeConversationNowFn` (Quinn Copilot P2-C.3, manual half): the
 * Copilot panel's Summarize chip. Covers the gate order (copilot.use ->
 * assistantCopilot flag -> assistant configured -> conversation viewable)
 * and that it never persists: it only forwards
 * `generateConversationSummaryText`'s result. createServerFn is stubbed to a
 * directly-callable fn (mirrors assistant-snippets.test.ts) so the real zod
 * validator runs on each call.
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
  generateConversationSummaryText: vi.fn(),
  generateTicketSummaryText: vi.fn(),
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
// `assertCopilotAvailable` (copilot-gate.ts) is exercised for real here, not
// mocked as a whole module: it's the one piece of gate logic this suite
// wants to assert against (flag -> configured, in order), composed from the
// isFeatureEnabled/isAssistantConfigured mocks above.
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: hoisted.assertTicketVisible,
}))
vi.mock('@/lib/server/domains/assistant/conversation-summary.service', () => ({
  generateConversationSummaryText: hoisted.generateConversationSummaryText,
  generateTicketSummaryText: hoisted.generateTicketSummaryText,
}))

import { summarizeConversationNowFn, summarizeTicketNowFn } from '../copilot-summary'

const CONVERSATION_ID = createId('conversation') as ConversationId
const TICKET_ID = createId('ticket') as TicketId

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.policyActorFromAuth.mockResolvedValue({ type: 'user', principalId: 'principal_admin' })
  hoisted.isFeatureEnabled.mockResolvedValue(true)
  hoisted.isAssistantConfigured.mockReturnValue(true)
  hoisted.assertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  hoisted.assertTicketVisible.mockResolvedValue({ id: TICKET_ID })
  hoisted.generateConversationSummaryText.mockResolvedValue({
    question: 'Refund window',
    bullets: ['Customer asked about refunds.', 'Explained the 30-day window.'],
  })
  hoisted.generateTicketSummaryText.mockResolvedValue({
    question: 'CSV export broken',
    bullets: ['Customer cannot export CSV.', 'Investigating.'],
  })
})

describe('summarizeConversationNowFn', () => {
  it('gates on copilot.use', async () => {
    await summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.COPILOT_USE })
  })

  it('checks the assistantCopilot flag after auth', async () => {
    await summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    expect(hoisted.isFeatureEnabled).toHaveBeenCalledWith('assistantCopilot')
  })

  it('rejects when the assistantCopilot flag is off, without generating anything', async () => {
    hoisted.isFeatureEnabled.mockResolvedValue(false)
    await expect(
      summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    ).rejects.toThrow()
    expect(hoisted.generateConversationSummaryText).not.toHaveBeenCalled()
  })

  it('rejects when the assistant is not configured', async () => {
    hoisted.isAssistantConfigured.mockReturnValue(false)
    await expect(
      summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    ).rejects.toThrow()
    expect(hoisted.generateConversationSummaryText).not.toHaveBeenCalled()
  })

  it('checks the conversation is viewable by the caller before summarizing', async () => {
    await summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    expect(hoisted.assertConversationViewable).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.anything()
    )
  })

  it('returns the question/bullets result on success', async () => {
    const result = await summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    expect(result).toEqual({
      question: 'Refund window',
      bullets: ['Customer asked about refunds.', 'Explained the 30-day window.'],
    })
  })

  it('rejects when there is nothing to summarize yet', async () => {
    hoisted.generateConversationSummaryText.mockResolvedValue(null)
    await expect(
      summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    ).rejects.toThrow()
  })

  it('rejects an invalid conversation id at the boundary, before touching auth', async () => {
    await expect(
      summarizeConversationNowFn({ data: { conversationId: 'not-a-real-id' } })
    ).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('propagates an auth rejection without checking the flag or generating', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(
      summarizeConversationNowFn({ data: { conversationId: CONVERSATION_ID } })
    ).rejects.toThrow('Access denied')
    expect(hoisted.isFeatureEnabled).not.toHaveBeenCalled()
    expect(hoisted.generateConversationSummaryText).not.toHaveBeenCalled()
  })
})

describe('summarizeTicketNowFn (unified inbox §2.9)', () => {
  it('gates on copilot.use, the assistantCopilot flag, and assistant configured, same order as the conversation fn', async () => {
    await summarizeTicketNowFn({ data: { ticketId: TICKET_ID } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.COPILOT_USE })
    expect(hoisted.isFeatureEnabled).toHaveBeenCalledWith('assistantCopilot')
  })

  it('checks the ticket is viewable by the caller before summarizing, never the conversation gate', async () => {
    await summarizeTicketNowFn({ data: { ticketId: TICKET_ID } })
    expect(hoisted.assertTicketVisible).toHaveBeenCalledWith(TICKET_ID, expect.anything())
    expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
  })

  it('returns the question/bullets result on success and writes nothing', async () => {
    const result = await summarizeTicketNowFn({ data: { ticketId: TICKET_ID } })
    expect(result).toEqual({
      question: 'CSV export broken',
      bullets: ['Customer cannot export CSV.', 'Investigating.'],
    })
  })

  it('rejects when there is nothing to summarize yet', async () => {
    hoisted.generateTicketSummaryText.mockResolvedValue(null)
    await expect(summarizeTicketNowFn({ data: { ticketId: TICKET_ID } })).rejects.toThrow()
  })

  it('rejects an invalid ticket id at the boundary, before touching auth', async () => {
    await expect(summarizeTicketNowFn({ data: { ticketId: 'not-a-real-id' } })).rejects.toThrow()
    expect(hoisted.requireAuth).not.toHaveBeenCalled()
  })

  it('404s (rejects) when the ticket does not exist or is not viewable', async () => {
    hoisted.assertTicketVisible.mockRejectedValue(new Error('Ticket not found'))
    await expect(summarizeTicketNowFn({ data: { ticketId: TICKET_ID } })).rejects.toThrow(
      'Ticket not found'
    )
    expect(hoisted.generateTicketSummaryText).not.toHaveBeenCalled()
  })
})
