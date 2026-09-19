/**
 * The inspector's authorization matrix (QUINN-PRODUCT Step 11, P8).
 *
 * The property under test is narrow and load-bearing: a run is read through the
 * visibility of the item it belongs to, taken from the row rather than from the
 * caller, and a run whose parent the caller cannot see is reported as missing
 * rather than refused, so it cannot be probed for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    let handler: ((args: { data: never }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: (schema ? schema.parse(args?.data) : args?.data) as never })
    }
    fn.validator = (nextSchema: { parse: (value: unknown) => unknown }) => {
      schema = nextSchema
      return fn
    }
    fn.handler = (nextHandler: (args: { data: never }) => Promise<unknown>) => {
      handler = nextHandler
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
  findAssistantRunParent: vi.fn(),
  getAssistantRunInspection: vi.fn(),
  listAssistantRunsForConversation: vi.fn(),
  listAssistantRunsForTicket: vi.fn(),
  cancelAssistantRun: vi.fn(),
  retryFailedAssistantRun: vi.fn(),
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
vi.mock('@/lib/server/domains/assistant/run-inspection', () => ({
  findAssistantRunParent: hoisted.findAssistantRunParent,
  getAssistantRunInspection: hoisted.getAssistantRunInspection,
  listAssistantRunsForConversation: hoisted.listAssistantRunsForConversation,
  listAssistantRunsForTicket: hoisted.listAssistantRunsForTicket,
}))
vi.mock('@/lib/server/domains/assistant/assistant-recovery', () => ({
  cancelAssistantRun: hoisted.cancelAssistantRun,
  retryFailedAssistantRun: hoisted.retryFailedAssistantRun,
}))

import {
  cancelAssistantRunFn,
  getAssistantRunFn,
  listAssistantRunsFn,
  retryAssistantRunFn,
} from '../assistant-runs'

const AUTH = { principal: { id: 'principal_me' } }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue({ principalId: 'principal_me' })
  hoisted.assertConversationViewable.mockResolvedValue(undefined)
  hoisted.assertTicketVisible.mockResolvedValue(undefined)
  hoisted.listAssistantRunsForConversation.mockResolvedValue([])
  hoisted.listAssistantRunsForTicket.mockResolvedValue([])
  hoisted.getAssistantRunInspection.mockResolvedValue({ id: 'assistant_run_1' })
  hoisted.cancelAssistantRun.mockResolvedValue({
    id: 'assistant_run_1',
    status: 'cancelled',
    disposition: 'cancelled:operator',
  })
  hoisted.retryFailedAssistantRun.mockResolvedValue({ id: 'assistant_run_2', status: 'queued' })
})

describe('listAssistantRunsFn', () => {
  it('checks the conversation the caller named before reading anything', async () => {
    await listAssistantRunsFn({ data: { conversationId: 'conversation_1' } })
    expect(hoisted.assertConversationViewable).toHaveBeenCalledWith('conversation_1', {
      principalId: 'principal_me',
    })
    expect(hoisted.listAssistantRunsForConversation).toHaveBeenCalled()
  })

  it('checks the ticket for a ticket parent', async () => {
    await listAssistantRunsFn({ data: { ticketId: 'ticket_1' } })
    expect(hoisted.assertTicketVisible).toHaveBeenCalledWith('ticket_1', {
      principalId: 'principal_me',
    })
  })

  it('reads nothing when the parent is not viewable', async () => {
    hoisted.assertConversationViewable.mockRejectedValue(new Error('nope'))
    await expect(
      listAssistantRunsFn({ data: { conversationId: 'conversation_1' } })
    ).rejects.toThrow()
    expect(hoisted.listAssistantRunsForConversation).not.toHaveBeenCalled()
  })

  it('refuses a request that names both parents or neither', async () => {
    await expect(
      listAssistantRunsFn({ data: { conversationId: 'conversation_1', ticketId: 'ticket_1' } })
    ).rejects.toThrow()
    await expect(listAssistantRunsFn({ data: {} })).rejects.toThrow()
  })
})

describe('getAssistantRunFn', () => {
  it("checks the run's own parent, not one the client supplied", async () => {
    hoisted.findAssistantRunParent.mockResolvedValue({
      conversationId: 'conversation_real',
      ticketId: null,
    })
    await getAssistantRunFn({ data: { runId: 'assistant_run_1' } })
    expect(hoisted.assertConversationViewable).toHaveBeenCalledWith('conversation_real', {
      principalId: 'principal_me',
    })
  })

  it('does not read the run when its parent is invisible', async () => {
    hoisted.findAssistantRunParent.mockResolvedValue({
      conversationId: 'conversation_hidden',
      ticketId: null,
    })
    hoisted.assertConversationViewable.mockRejectedValue(new Error('nope'))
    await expect(getAssistantRunFn({ data: { runId: 'assistant_run_1' } })).rejects.toThrow()
    expect(hoisted.getAssistantRunInspection).not.toHaveBeenCalled()
  })

  it('reports a run with no inbox parent as missing', async () => {
    hoisted.findAssistantRunParent.mockResolvedValue({ conversationId: null, ticketId: null })
    await expect(getAssistantRunFn({ data: { runId: 'assistant_run_1' } })).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_FOUND',
    })
    expect(hoisted.getAssistantRunInspection).not.toHaveBeenCalled()
  })

  it('reports an unknown run as missing', async () => {
    hoisted.findAssistantRunParent.mockResolvedValue(null)
    await expect(getAssistantRunFn({ data: { runId: 'assistant_run_x' } })).rejects.toMatchObject({
      code: 'ASSISTANT_RUN_NOT_FOUND',
    })
  })
})

describe('the recovery controls', () => {
  beforeEach(() => {
    hoisted.findAssistantRunParent.mockResolvedValue({
      conversationId: 'conversation_real',
      ticketId: null,
    })
  })

  it('asks for the authority to take the conversation over', async () => {
    await cancelAssistantRunFn({ data: { runId: 'assistant_run_1' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.CONVERSATION_REPLY,
    })
    await retryAssistantRunFn({ data: { runId: 'assistant_run_1' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.CONVERSATION_REPLY,
    })
  })

  it('cancels nothing when the parent is invisible', async () => {
    hoisted.assertConversationViewable.mockRejectedValue(new Error('nope'))
    await expect(cancelAssistantRunFn({ data: { runId: 'assistant_run_1' } })).rejects.toThrow()
    expect(hoisted.cancelAssistantRun).not.toHaveBeenCalled()
  })

  it('re-runs nothing when the parent is invisible', async () => {
    hoisted.assertConversationViewable.mockRejectedValue(new Error('nope'))
    await expect(retryAssistantRunFn({ data: { runId: 'assistant_run_1' } })).rejects.toThrow()
    expect(hoisted.retryFailedAssistantRun).not.toHaveBeenCalled()
  })

  it('refuses to re-run a run with no conversation behind it', async () => {
    hoisted.findAssistantRunParent.mockResolvedValue({
      conversationId: null,
      ticketId: 'ticket_1',
    })
    await expect(retryAssistantRunFn({ data: { runId: 'assistant_run_1' } })).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' }
    )
    expect(hoisted.retryFailedAssistantRun).not.toHaveBeenCalled()
  })

  it('names the operator as the requester of the new turn', async () => {
    await retryAssistantRunFn({ data: { runId: 'assistant_run_1' } })
    expect(hoisted.retryFailedAssistantRun).toHaveBeenCalledWith('assistant_run_1', {
      requestedByPrincipalId: 'principal_me',
    })
  })
})
