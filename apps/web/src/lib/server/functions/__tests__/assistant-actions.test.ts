/**
 * Tests for approveAssistantActionFn / rejectAssistantActionFn.
 *
 * Orchestration only: the fns resolve the tool spec, gate on the approver
 * holding every permission the tool declares, decide, and (on approve) commit
 * the decision together with the execution job. Nothing is dispatched here
 * any more; the worker owns that, and re-resolves every gate again at the
 * moment of the effect. Domain services are mocked at their module boundary;
 * `can` runs for real against a constructed actor so the permission gate is
 * meaningfully exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { fakePendingActionRow } from '@/lib/server/domains/assistant/__tests__/assistant-tool-fixtures'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'

// createServerFn → directly-callable fns (mirrors conversation-bulk.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
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
  decideAndEnqueuePendingAction: vi.fn(),
  resolveToolSpecs: vi.fn(),
  resolveConnectorApprovalSpec: vi.fn(),
  getAssistantRuntimeConfig: vi.fn(),
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
  decideAndEnqueuePendingAction: hoisted.decideAndEnqueuePendingAction,
}))

vi.mock('@/lib/server/domains/assistant/assistant.toolspec', () => ({
  // Static lookup over the test-controlled built-in registry fixture.
  getToolSpecByName: (name: string) => {
    const specs = (hoisted.resolveToolSpecs() ?? []) as Array<{ name: string }>
    return specs.find((s) => s.name === name) ?? null
  },
  // Faithful pure replica of the real factory (the module is fully mocked to
  // keep its heavy import graph out of this test).
  makeAssistantToolContext: (init: Record<string, unknown>) => ({
    db: init.db,
    assistantPrincipalId: init.assistantPrincipalId,
    assistantName: init.assistantName,
    role: init.role,
    audience: init.audience,
    conversationId: init.conversationId,
    ticketId: init.ticketId ?? null,
    sources: new Map(),
    toolCalls: [],
    handoffRequest: null,
    inabilityReport: null,
    proposedActions: [],
    toolOutcomes: [],
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

vi.mock('@/lib/server/domains/assistant/connectors/connector-tools', () => ({
  resolveConnectorApprovalSpec: hoisted.resolveConnectorApprovalSpec,
}))

vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantRuntimeConfig: hoisted.getAssistantRuntimeConfig,
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
  parents: ['conversation', 'ticket'] as const,
  permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
  definition: { inputSchema: z.object({ reason: z.string() }) } as never,
  execute: vi.fn(),
  summarize: () => 'Close conversation',
}

function actorWith(permissions: string[]) {
  return { principalId: 'principal_agent1', role: 'member', permissions: new Set(permissions) }
}

const pendingRow = (overrides: Partial<Record<string, unknown>> = {}) =>
  fakePendingActionRow({ originRole: 'customer_support', ...overrides })

/** DTO shape assertion helper , approve/reject return the JSON-serializable
 *  DTO (toDTO), not the raw row with Date fields, so expectations compare
 *  against this instead of the mocked row objects directly. */
function expectDTOFrom(row: Record<string, unknown>): Partial<AssistantPendingActionDTO> {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null))
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    involvementId: row.involvementId as string | null,
    toolName: row.toolName as string,
    originRole: row.originRole as AssistantPendingActionDTO['originRole'],
    status: row.status as string,
    proposedAt: iso(row.proposedAt) as string,
    decidedById: (row.decidedById as string | null) ?? null,
    decidedAt: iso(row.decidedAt) as string | null,
    executedAt: iso(row.executedAt) as string | null,
    result: (row.result as AssistantPendingActionDTO['result']) ?? null,
  }
}

// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const approve = (data: any) => approveAssistantActionFn({ data })
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const reject = (data: any) => rejectAssistantActionFn({ data })

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue(AUTH)
  hoisted.policyActorFromAuth.mockResolvedValue(actorWith([PERMISSIONS.CONVERSATION_SET_STATUS]))
  hoisted.resolveToolSpecs.mockReturnValue([CLOSE_SPEC])
  // Custom-action resolver defaults: no dynamic spec, flag on. Built-in tests
  // (toolName without an `action_` prefix) never touch either.
  hoisted.resolveConnectorApprovalSpec.mockResolvedValue({ status: 'absent' })
  hoisted.getAssistantRuntimeConfig.mockResolvedValue({})
  hoisted.ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn' })
  hoisted.assertConversationViewable.mockResolvedValue(undefined)
  hoisted.assertTicketVisible.mockResolvedValue(undefined)
  hoisted.decideAndEnqueuePendingAction.mockImplementation(
    async (input: { id: string; decision: string }) => ({
      action: {
        ...fakePendingActionRow({ originRole: 'customer_support' }),
        status: input.decision,
        decidedById: 'principal_agent1',
        executionState: 'queued',
      },
      enqueued: true,
    })
  )
})

describe('approveAssistantActionFn', () => {
  it('commits the decision and the execution job together, and returns approved-and-queued', async () => {
    const pending = pendingRow()
    const approver = actorWith([PERMISSIONS.CONVERSATION_SET_STATUS])
    hoisted.policyActorFromAuth.mockResolvedValue(approver)
    hoisted.getPendingActionById.mockResolvedValue(pending)
    const queued = {
      ...pending,
      status: 'approved',
      decidedById: 'principal_agent1',
      executionState: 'queued',
      executionJobId: 'job_1',
    }
    hoisted.decideAndEnqueuePendingAction.mockResolvedValue({ action: queued, enqueued: true })

    const out = await approve({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.decideAndEnqueuePendingAction).toHaveBeenCalledWith({
      id: 'assistant_action_1',
      decision: 'approved',
      decidedById: 'principal_agent1',
      // The exact operation the reviewer approved, digested from the PARSED
      // arguments, so what the worker compares is what would actually run.
      approvedArgsDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    // Nothing was dispatched inside the request, and the answer says queued,
    // not completed.
    expect(out).toEqual(
      expect.objectContaining({ status: 'approved', executionState: 'queued', executedAt: null })
    )
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.CONVERSATION_VIEW })
  })

  it('conflicts rather than queueing when the row is no longer decidable', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.decideAndEnqueuePendingAction.mockResolvedValue(null)

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it('refuses when the discovered contract moved since the proposal was rendered', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow({ contractDigest: 'old' }))
    hoisted.resolveToolSpecs.mockReturnValue([{ ...CLOSE_SPEC, contractDigest: 'new' }])

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(hoisted.decideAndEnqueuePendingAction).not.toHaveBeenCalled()
  })

  it('rejects with no execution unless the approver holds every permission the tool declares', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.resolveToolSpecs.mockReturnValue([
      {
        ...CLOSE_SPEC,
        permissions: [PERMISSIONS.CONVERSATION_SET_STATUS, PERMISSIONS.CONVERSATION_REPLY],
      },
    ])
    hoisted.policyActorFromAuth.mockResolvedValue(actorWith([PERMISSIONS.CONVERSATION_SET_STATUS]))

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toThrow(
      /conversation\.reply/
    )

    expect(hoisted.decideAndEnqueuePendingAction).not.toHaveBeenCalled()
  })

  it('rejects when the current tool spec is read-only', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.resolveToolSpecs.mockReturnValue([{ ...CLOSE_SPEC, risk: 'read' }])

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
  })

  it('rejects when the current tool spec does not support the stored parent', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.resolveToolSpecs.mockReturnValue([{ ...CLOSE_SPEC, parents: ['ticket'] }])

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
  })

  it('rejects when the stored args no longer pass the current input schema', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow({ args: {} }))

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(hoisted.decideAndEnqueuePendingAction).not.toHaveBeenCalled()
  })

  it('conflicts when the proposal was already decided or has expired', async () => {
    hoisted.getPendingActionById.mockResolvedValue(pendingRow())
    hoisted.decideAndEnqueuePendingAction.mockResolvedValue(null)

    await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toThrow(
      /already decided or has expired/
    )
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

  describe('connectors', () => {
    it('410s and never decides when the connector was deleted since the proposal', async () => {
      hoisted.getPendingActionById.mockResolvedValue(
        pendingRow({ toolName: 'connector_acme__issue_refund' })
      )
      hoisted.resolveToolSpecs.mockReturnValue([])
      hoisted.resolveConnectorApprovalSpec.mockResolvedValue({ status: 'absent' })

      await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
        statusCode: 410,
      })
      expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
    })

    it('conflicts and never executes when the policy moved to never since the proposal', async () => {
      hoisted.getPendingActionById.mockResolvedValue(
        pendingRow({ toolName: 'connector_acme__issue_refund' })
      )
      hoisted.resolveToolSpecs.mockReturnValue([])
      hoisted.resolveConnectorApprovalSpec.mockResolvedValue({
        status: 'denied',
        reason: 'override',
      })

      await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
        code: 'ASSISTANT_ACTION_POLICY_CHANGED',
      })
      expect(hoisted.decidePendingAction).not.toHaveBeenCalled()
    })

    it('conflicts when the tool contract changed and has not been reviewed since', async () => {
      hoisted.getPendingActionById.mockResolvedValue(
        pendingRow({ toolName: 'connector_acme__issue_refund' })
      )
      hoisted.resolveToolSpecs.mockReturnValue([])
      hoisted.resolveConnectorApprovalSpec.mockResolvedValue({
        status: 'denied',
        reason: 'tool_unreviewed',
      })

      await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
        code: 'ASSISTANT_ACTION_POLICY_CHANGED',
        message: expect.stringContaining('review'),
      })
    })

    it('re-resolves the use the proposal was made under, not the approver own', async () => {
      hoisted.getPendingActionById.mockResolvedValue(
        pendingRow({
          toolName: 'connector_acme__issue_refund',
          originRole: 'customer_support',
          originProfile: 'agent',
          policyVersion: 3,
        })
      )
      hoisted.resolveToolSpecs.mockReturnValue([])
      hoisted.resolveConnectorApprovalSpec.mockResolvedValue({ status: 'absent' })

      await expect(approve({ pendingActionId: 'assistant_action_1' })).rejects.toMatchObject({
        statusCode: 410,
      })
      expect(hoisted.resolveConnectorApprovalSpec).toHaveBeenCalledWith({
        toolName: 'connector_acme__issue_refund',
        profile: 'agent',
        proposedPolicyVersion: 3,
      })
    })
  })

  describe('row-level parent authz (unified inbox §3.3)', () => {
    it('authorizes against the conversation the pending action is scoped to, before deciding', async () => {
      const pending = pendingRow({ conversationId: 'conversation_1', ticketId: null })
      hoisted.getPendingActionById.mockResolvedValue(pending)
      hoisted.decideAndEnqueuePendingAction.mockResolvedValue({
        action: { ...pending, status: 'approved', executionState: 'queued' },
        enqueued: true,
      })

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
      hoisted.decideAndEnqueuePendingAction.mockResolvedValue({
        action: { ...pending, status: 'approved', executionState: 'queued' },
        enqueued: true,
      })

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
  it('decides rejected without a live tool spec or write permission and never executes', async () => {
    const pending = pendingRow({ toolName: 'vanished_tool' })
    hoisted.getPendingActionById.mockResolvedValue(pending)
    hoisted.resolveToolSpecs.mockReturnValue([])
    hoisted.policyActorFromAuth.mockResolvedValue(actorWith([]))
    const rejected = { ...pending, status: 'rejected', decidedById: 'principal_agent1' }
    hoisted.decidePendingAction.mockResolvedValue(rejected)

    const out = await reject({ pendingActionId: 'assistant_action_1' })

    expect(hoisted.decidePendingAction).toHaveBeenCalledWith(
      'assistant_action_1',
      'rejected',
      'principal_agent1'
    )
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.CONVERSATION_VIEW })
    expect(hoisted.resolveToolSpecs).not.toHaveBeenCalled()
    expect(out).toEqual(expect.objectContaining(expectDTOFrom(rejected)))
  })
})
