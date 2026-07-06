/**
 * Tests for approveAssistantActionFn / rejectAssistantActionFn.
 *
 * Orchestration only: the fns resolve the tool spec, gate on the approver
 * holding every permission the tool declares, decide, and (on approve) run
 * the same execute-approved pipeline seam autonomous mode uses. Domain
 * services are mocked at their module boundary; `can` runs for real against a
 * constructed actor so the permission gate is meaningfully exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakePendingActionRow } from '@/lib/server/domains/assistant/__tests__/assistant-tool-fixtures'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'

// createServerFn → directly-callable fns (mirrors conversation-bulk.test.ts).
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
  decidePendingAction: vi.fn(),
  markPendingActionExecuted: vi.fn(),
  markPendingActionFailed: vi.fn(),
  resolveToolSpecs: vi.fn(),
  executeApprovedPendingAction: vi.fn(),
  ensureAssistantPrincipal: vi.fn(),
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

vi.mock('@/lib/server/db', () => ({ db: {} }))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))

vi.mock('@/lib/server/domains/assistant/pending-actions.service', () => ({
  getPendingActionById: hoisted.getPendingActionById,
  decidePendingAction: hoisted.decidePendingAction,
  markPendingActionExecuted: hoisted.markPendingActionExecuted,
  markPendingActionFailed: hoisted.markPendingActionFailed,
}))

vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  resolveToolSpecs: hoisted.resolveToolSpecs,
  // The fn under test looks specs up by name; derive the record lazily from
  // the same mocked list so each test controls both surfaces with one mock.
  get ASSISTANT_TOOL_SPECS() {
    const specs = (hoisted.resolveToolSpecs() ?? []) as Array<{ name: string }>
    return Object.fromEntries(specs.map((s) => [s.name, s]))
  },
  // Faithful pure replica of the real lookup (async over the same mocked
  // list — the fn under test now calls this instead of indexing
  // ASSISTANT_TOOL_SPECS directly, so a connector_* name resolves too).
  getToolSpecByName: async (name: string) => {
    const specs = ((await hoisted.resolveToolSpecs()) ?? []) as Array<{ name: string }>
    return specs.find((s) => s.name === name) ?? null
  },
  // Faithful pure replica of the real factory (the module is fully mocked to
  // keep its heavy import graph out of this test).
  makeAssistantToolContext: (init: Record<string, unknown>) => ({
    db: init.db,
    assistantPrincipalId: init.assistantPrincipalId,
    audience: init.audience,
    conversationId: init.conversationId,
    ticketId: init.ticketId ?? null,
    sources: new Map(),
    searchCalls: 0,
    simulate: init.simulate ?? init.conversationId === null,
    involvementId: init.involvementId ?? null,
    latestCustomerMessageId: init.latestCustomerMessageId ?? null,
    actor: init.actor ?? {
      principalId: init.assistantPrincipalId,
      role: 'admin',
      principalType: 'service',
      segmentIds: new Set(),
      permissions: new Set(),
    },
  }),
}))

vi.mock('@/lib/server/domains/assistant/assistant.tools', () => ({
  executeApprovedPendingAction: hoisted.executeApprovedPendingAction,
}))

vi.mock('@/lib/server/domains/assistant/assistant.principal', () => ({
  ensureAssistantPrincipal: hoisted.ensureAssistantPrincipal,
}))

vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: hoisted.assertConversationViewable,
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: hoisted.assertTicketVisible,
}))

import { approveAssistantActionFn, rejectAssistantActionFn } from '../assistant-actions'
import type { AssistantPendingActionDTO } from '../assistant-actions'

const AUTH = {
  user: { id: 'user_1', email: 'agent@x', name: 'Agent', image: null },
  principal: { id: 'principal_agent1', role: 'member' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}

const CLOSE_SPEC = {
  name: 'close_conversation',
  label: 'Close conversation',
  description: 'Close the conversation.',
  risk: 'write' as const,
  supportedModes: ['approval', 'autonomous'] as const,
  defaultMode: 'approval' as const,
  permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
  definition: {} as never,
  execute: vi.fn(),
  summarize: () => 'Close conversation',
}

function actorWith(permissions: string[]) {
  return { principalId: 'principal_agent1', role: 'member', permissions: new Set(permissions) }
}

const pendingRow = fakePendingActionRow

/** DTO shape assertion helper — approve/reject return the JSON-serializable
 *  DTO (toDTO), not the raw row with Date fields, so expectations compare
 *  against this instead of the mocked row objects directly. */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const approve = (data: any) => approveAssistantActionFn({ data })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reject = (data: any) => rejectAssistantActionFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue(actorWith([PERMISSIONS.CONVERSATION_SET_STATUS]))
  hoisted.resolveToolSpecs.mockReturnValue([CLOSE_SPEC])
  hoisted.ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn' })
  hoisted.assertConversationViewable.mockResolvedValue(undefined)
  hoisted.assertTicketVisible.mockResolvedValue(undefined)
})

describe('approveAssistantActionFn', () => {
  it('executes via the same pipeline seam, links the audit row, and settles the row', async () => {
    const pending = pendingRow()
    hoisted.getPendingActionById.mockResolvedValue(pending)
    const decided = { ...pending, status: 'approved', decidedById: 'principal_agent1' }
    hoisted.decidePendingAction.mockResolvedValue(decided)
    hoisted.executeApprovedPendingAction.mockResolvedValue({
      status: 'executed',
      result: { closed: true },
    })
    const settled = { ...decided, status: 'executed', result: { closed: true } }
    hoisted.markPendingActionExecuted.mockResolvedValue(settled)

    const out = await approve({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.decidePendingAction).toHaveBeenCalledWith(
      'assistant_action_1',
      'approved',
      'principal_agent1'
    )
    expect(hoisted.executeApprovedPendingAction).toHaveBeenCalledWith(
      CLOSE_SPEC,
      decided,
      expect.objectContaining({
        assistantPrincipalId: 'principal_quinn',
        conversationId: 'conversation_1',
        involvementId: 'assistant_involvement_1',
        simulate: false,
      })
    )
    expect(hoisted.markPendingActionExecuted).toHaveBeenCalledWith('assistant_action_1', {
      closed: true,
    })
    expect(hoisted.markPendingActionFailed).not.toHaveBeenCalled()
    expect(out).toEqual(expect.objectContaining(expectDTOFrom(settled)))
  })

  it('threads the ticket parent onto the execution context for a ticket-scoped pending action (unified inbox §2.9)', async () => {
    const pending = pendingRow({ conversationId: null, ticketId: 'ticket_1' })
    hoisted.getPendingActionById.mockResolvedValue(pending)
    const decided = { ...pending, status: 'approved', decidedById: 'principal_agent1' }
    hoisted.decidePendingAction.mockResolvedValue(decided)
    hoisted.executeApprovedPendingAction.mockResolvedValue({
      status: 'executed',
      result: { created: true },
    })
    hoisted.markPendingActionExecuted.mockResolvedValue({
      ...decided,
      status: 'executed',
      result: { created: true },
    })

    await approve({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.executeApprovedPendingAction).toHaveBeenCalledWith(
      CLOSE_SPEC,
      decided,
      expect.objectContaining({
        conversationId: null,
        ticketId: 'ticket_1',
      })
    )
  })

  it('settles failed when execution fails, without throwing', async () => {
    const pending = pendingRow()
    hoisted.getPendingActionById.mockResolvedValue(pending)
    const decided = { ...pending, status: 'approved' }
    hoisted.decidePendingAction.mockResolvedValue(decided)
    hoisted.executeApprovedPendingAction.mockResolvedValue({
      status: 'failed',
      error: 'boom',
    })
    const settled = { ...decided, status: 'failed', result: { error: 'boom' } }
    hoisted.markPendingActionFailed.mockResolvedValue(settled)

    const out = await approve({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.markPendingActionFailed).toHaveBeenCalledWith('assistant_action_1', 'boom')
    expect(out).toEqual(expect.objectContaining(expectDTOFrom(settled)))
  })

  it('rejects with no execution when the approver is missing a permission the tool declares', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.policyActorFromAuth.mockResolvedValue(actorWith([])) // missing conversation.set_status

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toThrow(
      /conversation\.set_status/
    )

    expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
    expect(hoisted.executeApprovedPendingAction).not.toHaveBeenCalled()
  })

  it('conflicts when the proposal was already decided or has expired', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.decidePendingAction.mockResolvedValue(null)

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toThrow(
      /already decided or has expired/
    )
    expect(hoisted.executeApprovedPendingAction).not.toHaveBeenCalled()
  })

  it('rejects with a 410-style error when the tool spec no longer exists in the catalogue', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow({ toolName: 'vanished_tool' }))
    hoisted.resolveToolSpecs.mockReturnValue([])

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
      statusCode: 410,
    })
    expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
  })

  it('404s when the pending action does not exist', async () => {
    hoisted.getPendingActionById.mockResolvedValue(null)

    await expect(approve({ pendingActionId: 'nope' })).rejects.toMatchObject({ statusCode: 404 })
  })

  describe('row-level parent authz (unified inbox §3.3)', () => {
    it('authorizes against the conversation the pending action is scoped to, before deciding', async () => {
      const pending = pendingRow({ conversationId: 'conversation_1', ticketId: null })
      hoisted.getPendingActionById.mockResolvedValue(pending)
      hoisted.decidePendingAction.mockResolvedValue({ ...pending, status: 'approved' })
      hoisted.executeApprovedPendingAction.mockResolvedValue({
        status: 'executed',
        result: { closed: true },
      })
      hoisted.markPendingActionExecuted.mockResolvedValue({ ...pending, status: 'executed' })

      await approve({ pendingActionId: 'assistant_action_1' })

      expect(hoisted.assertConversationViewable).toHaveBeenCalledWith(
        'conversation_1',
        expect.objectContaining({ principalId: 'principal_agent1' })
      )
      expect(hoisted.assertTicketVisible).not.toHaveBeenCalled()
    })

    it('authorizes against the ticket the pending action is scoped to, before deciding', async () => {
      const pending = pendingRow({ conversationId: null, ticketId: 'ticket_1' })
      hoisted.getPendingActionById.mockResolvedValue(pending)
      hoisted.decidePendingAction.mockResolvedValue({ ...pending, status: 'approved' })
      hoisted.executeApprovedPendingAction.mockResolvedValue({
        status: 'executed',
        result: { created: true },
      })
      hoisted.markPendingActionExecuted.mockResolvedValue({ ...pending, status: 'executed' })

      await approve({ pendingActionId: 'assistant_action_1' })

      expect(hoisted.assertTicketVisible).toHaveBeenCalledWith(
        'ticket_1',
        expect.objectContaining({ principalId: 'principal_agent1' })
      )
      expect(hoisted.assertConversationViewable).not.toHaveBeenCalled()
    })

    it('404s (never executing or deciding) when the approver holds conversation.view but cannot see this ticket-scoped row', async () => {
      const pending = pendingRow({ conversationId: null, ticketId: 'ticket_1' })
      hoisted.getPendingActionById.mockResolvedValue(pending)
      hoisted.assertTicketVisible.mockRejectedValue(
        new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
      )

      await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
        statusCode: 404,
      })

      expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
      expect(hoisted.executeApprovedPendingAction).not.toHaveBeenCalled()
    })

    it('404s (never executing or deciding) when the approver cannot view the conversation this row is scoped to', async () => {
      const pending = pendingRow({ conversationId: 'conversation_1', ticketId: null })
      hoisted.getPendingActionById.mockResolvedValue(pending)
      hoisted.assertConversationViewable.mockRejectedValue(
        new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
      )

      await expect(reject({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
        statusCode: 404,
      })

      expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
    })
  })
})

describe('rejectAssistantActionFn', () => {
  it('decides rejected and never executes', async () => {
    const pending = pendingRow()
    hoisted.getPendingActionById.mockResolvedValue(pending)
    const rejected = { ...pending, status: 'rejected', decidedById: 'principal_agent1' }
    hoisted.decidePendingAction.mockResolvedValue(rejected)

    const out = await reject({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.decidePendingAction).toHaveBeenCalledWith(
      'assistant_action_1',
      'rejected',
      'principal_agent1'
    )
    expect(hoisted.executeApprovedPendingAction).not.toHaveBeenCalled()
    expect(out).toEqual(expect.objectContaining(expectDTOFrom(rejected)))
  })
})
