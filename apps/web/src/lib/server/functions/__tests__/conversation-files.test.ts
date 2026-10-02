/**
 * Tests for listConversationFilesFn's permission gate (lib/server/functions/
 * conversation-files.ts): CONVERSATION_VIEW + team-member for a conversation
 * target, TICKET_VIEW for a ticket target, and the item-scoped viewability
 * check on whichever target was named. The read itself (files.query.ts) is
 * covered by its own real-DB test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerFn → directly-callable fns (mirrors conversation-transcript-export.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  assertConversationViewable: vi.fn(),
  assertTicketVisible: vi.fn(),
  listConversationFiles: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: hoisted.assertConversationViewable,
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: hoisted.assertTicketVisible,
}))
vi.mock('@/lib/server/domains/files/files.query', () => ({
  listConversationFiles: hoisted.listConversationFiles,
}))

import { listConversationFilesFn } from '../conversation-files'

const CONVERSATION_ID = 'conversation_01h455vb4pex5vsknk084sn02q'
const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_agent', role: 'admin' } })
  hoisted.policyActorFromAuth.mockResolvedValue({ principalId: 'principal_agent', role: 'admin' })
  hoisted.assertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  hoisted.assertTicketVisible.mockResolvedValue({ id: TICKET_ID })
  hoisted.listConversationFiles.mockResolvedValue([])
})

describe('listConversationFilesFn', () => {
  it('reads a conversation target behind CONVERSATION_VIEW + the item-scoped viewability check', async () => {
    await listConversationFilesFn({ data: { conversationId: CONVERSATION_ID } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ permission: expect.stringContaining('conversation') })
    )
    expect(hoisted.assertConversationViewable).toHaveBeenCalledWith(CONVERSATION_ID, {
      principalId: 'principal_agent',
      role: 'admin',
    })
    expect(hoisted.listConversationFiles).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID })
  })

  it('refuses a non-team principal on a conversation target, before reading anything', async () => {
    hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_visitor', role: 'user' } })
    await expect(
      listConversationFilesFn({ data: { conversationId: CONVERSATION_ID } })
    ).rejects.toThrow(/team members/i)
    expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
    expect(hoisted.listConversationFiles).not.toHaveBeenCalled()
  })

  it('reads a ticket target behind TICKET_VIEW + assertTicketVisible', async () => {
    await listConversationFilesFn({ data: { ticketId: TICKET_ID } })
    expect(hoisted.assertTicketVisible).toHaveBeenCalledWith(TICKET_ID, {
      principalId: 'principal_agent',
      role: 'admin',
    })
    expect(hoisted.listConversationFiles).toHaveBeenCalledWith({ ticketId: TICKET_ID })
  })

  it('rejects a request naming neither target', async () => {
    await expect(listConversationFilesFn({ data: {} })).rejects.toThrow()
    expect(hoisted.listConversationFiles).not.toHaveBeenCalled()
  })

  it('rejects a malformed id without reaching the viewability check', async () => {
    await expect(
      listConversationFilesFn({ data: { conversationId: "x' OR 1=1" } })
    ).rejects.toThrow()
    expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
  })
})
