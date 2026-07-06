/**
 * Tests for getAssistantPendingActionFn — the read the inbox approval card
 * polls for live status, instead of trusting the stale note snapshot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakePendingActionRow } from '@/lib/server/domains/assistant/__tests__/assistant-tool-fixtures'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'

// createServerFn → directly-callable fns (mirrors assistant-actions.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler(args)
    }
    fn.validator = () => fn
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
  getPendingActionById: vi.fn(),
  assertConversationViewable: vi.fn(),
  assertTicketVisible: vi.fn(),
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.log, child })
  return { logger: { ...hoisted.log, child }, createLogger: () => ({ ...hoisted.log, child }) }
})

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))

vi.mock('@/lib/server/domains/assistant/pending-actions.service', () => ({
  getPendingActionById: hoisted.getPendingActionById,
}))

vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: hoisted.assertConversationViewable,
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: hoisted.assertTicketVisible,
}))

import { getAssistantPendingActionFn } from '../assistant-pending-actions'
import type { AssistantPendingActionDTO } from '../assistant-actions'

const AUTH = {
  user: { id: 'user_1', email: 'agent@x', name: 'Agent', image: null },
  principal: { id: 'principal_agent1', role: 'member' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}

/** DTO shape assertion helper, mirroring assistant-actions.test.ts's. */
function expectDTOFrom(row: Record<string, unknown>): Partial<AssistantPendingActionDTO> {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null))
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    involvementId: row.involvementId as string | null,
    toolName: row.toolName as string,
    status: row.status as string,
    proposedAt: iso(row.proposedAt) as string,
    decidedById: (row.decidedById as string | null) ?? null,
    decidedAt: iso(row.decidedAt) as string | null,
    executedAt: iso(row.executedAt) as string | null,
    result: (row.result as AssistantPendingActionDTO['result']) ?? null,
  }
}

function actorWith(permissions: string[]) {
  return { principalId: 'principal_agent1', role: 'member', permissions: new Set(permissions) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchPendingAction = (data: any) => getAssistantPendingActionFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue(actorWith([PERMISSIONS.CONVERSATION_VIEW]))
  hoisted.assertConversationViewable.mockResolvedValue(undefined)
  hoisted.assertTicketVisible.mockResolvedValue(undefined)
})

describe('getAssistantPendingActionFn', () => {
  it('gates on conversation.view before reading the row', async () => {
    hoisted.getPendingActionById.mockResolvedValue(fakePendingActionRow())

    await fetchPendingAction({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.CONVERSATION_VIEW })
  })

  it('returns the live row as the settled DTO shape', async () => {
    const row = fakePendingActionRow({ status: 'proposed' })
    hoisted.getPendingActionById.mockResolvedValue(row)

    const out = await fetchPendingAction({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.getPendingActionById).toHaveBeenCalledWith('assistant_action_1')
    expect(out).toEqual(expect.objectContaining(expectDTOFrom(row)))
  })

  it('reflects a decided/executed row (not the stale proposed snapshot)', async () => {
    const row = fakePendingActionRow({
      status: 'executed',
      decidedById: 'principal_agent1',
      decidedAt: new Date('2026-07-01T00:05:00.000Z'),
      executedAt: new Date('2026-07-01T00:05:01.000Z'),
      result: { closed: true },
    })
    hoisted.getPendingActionById.mockResolvedValue(row)

    const out = await fetchPendingAction({ pendingActionId: 'assistant_action_1' })

    expect(out).toEqual(expect.objectContaining(expectDTOFrom(row)))
  })

  it('404s when the pending action does not exist', async () => {
    hoisted.getPendingActionById.mockResolvedValue(null)

    await expect(fetchPendingAction({ pendingActionId: 'nope' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  describe('row-level parent authz (unified inbox §3.3)', () => {
    it('authorizes a conversation-scoped row against the conversation, not the ticket helper', async () => {
      const row = fakePendingActionRow({ conversationId: 'conversation_1', ticketId: null })
      hoisted.getPendingActionById.mockResolvedValue(row)

      await fetchPendingAction({ pendingActionId: 'assistant_action_1' })

      expect(hoisted.assertConversationViewable).toHaveBeenCalledWith(
        'conversation_1',
        expect.objectContaining({ principalId: 'principal_agent1' })
      )
      expect(hoisted.assertTicketVisible).not.toHaveBeenCalled()
    })

    it('authorizes a ticket-scoped row against the ticket, not the conversation helper', async () => {
      const row = fakePendingActionRow({ conversationId: null, ticketId: 'ticket_1' })
      hoisted.getPendingActionById.mockResolvedValue(row)

      await fetchPendingAction({ pendingActionId: 'assistant_action_1' })

      expect(hoisted.assertTicketVisible).toHaveBeenCalledWith(
        'ticket_1',
        expect.objectContaining({ principalId: 'principal_agent1' })
      )
      expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
    })

    it('404s when the caller holds conversation.view but cannot see this ticket-scoped row', async () => {
      const row = fakePendingActionRow({ conversationId: null, ticketId: 'ticket_1' })
      hoisted.getPendingActionById.mockResolvedValue(row)
      hoisted.assertTicketVisible.mockRejectedValue(
        new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
      )

      await expect(
        fetchPendingAction({ pendingActionId: 'assistant_action_1' })
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
