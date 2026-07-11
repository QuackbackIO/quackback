/**
 * The shared workflow action executor (§4.6, Slice 3; Phase C conversational
 * block layer, slice C-1): each action dispatches to the right conversation
 * service with the right args and returns an ActionResult. A thin dispatch
 * layer, so it is unit-tested with the services mocked (apply_sla's deep
 * behavior is covered end-to-end by sla.service.test). Failures propagate —
 * the caller owns best-effort vs fail-fast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  ConversationId,
  PrincipalId,
  TeamId,
  ConversationTagId,
  SlaPolicyId,
  DataConnectorId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'

// vi.hoisted so the fns exist when the (statically-imported) mock factories run
// at module load, before the top-level consts would otherwise initialize.
const {
  assignConversation,
  assignTeam,
  setConversationPriority,
  snoozeConversation,
  setConversationStatus,
  appendAssistantReply,
  recordCsat,
  addAgentNote,
  attachTag,
  detachTag,
  applySlaToConversation,
  setConversationAttribute,
  ensureAssistantPrincipal,
  resolveWorkflowVariables,
  getMessengerConfig,
  getOfficeHoursSchedule,
  buildReplyTimeMessage,
  runAssistantTurnForConversation,
} = vi.hoisted(() => ({
  assignConversation: vi.fn(),
  assignTeam: vi.fn(),
  setConversationPriority: vi.fn(),
  snoozeConversation: vi.fn(),
  setConversationStatus: vi.fn(),
  appendAssistantReply: vi.fn(),
  recordCsat: vi.fn(),
  addAgentNote: vi.fn(),
  attachTag: vi.fn(),
  detachTag: vi.fn(),
  applySlaToConversation: vi.fn(),
  setConversationAttribute: vi.fn(),
  ensureAssistantPrincipal: vi.fn(),
  resolveWorkflowVariables: vi.fn(),
  getMessengerConfig: vi.fn(),
  getOfficeHoursSchedule: vi.fn(),
  buildReplyTimeMessage: vi.fn(),
  runAssistantTurnForConversation: vi.fn(),
}))

vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assignConversation,
  assignTeam,
  setConversationPriority,
  snoozeConversation,
  setConversationStatus,
  appendAssistantReply,
  recordCsat,
  addAgentNote,
}))
vi.mock('@/lib/server/domains/conversation/conversation-tag.service', () => ({
  attachTag,
  detachTag,
}))
vi.mock('@/lib/server/domains/sla/sla.service', () => ({ applySlaToConversation }))
vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute,
}))
vi.mock('@/lib/server/domains/assistant/assistant.principal', () => ({ ensureAssistantPrincipal }))
vi.mock('../workflow-variables', () => ({ resolveWorkflowVariables }))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({ getMessengerConfig }))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({ getOfficeHoursSchedule }))
vi.mock('@/lib/server/domains/office-hours/reply-time-message', () => ({ buildReplyTimeMessage }))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation,
}))

// Ticket actions (set_ticket_status / convert_to_ticket) + CSAT-over-email's
// own dependencies — each mocked at its own seam so this stays a unit test of
// action.executor.ts's dispatch/resolution logic, not an integration test of
// the tickets domain or the email package.
const {
  setTicketStatus,
  createTicketCore,
  linkTicketToConversation,
  getLinkedCustomerTicket,
  buildHookContext,
  mintCsatEmailToken,
  sendCsatRequestEmail,
} = vi.hoisted(() => ({
  setTicketStatus: vi.fn(),
  createTicketCore: vi.fn(),
  linkTicketToConversation: vi.fn(),
  getLinkedCustomerTicket: vi.fn(),
  buildHookContext: vi.fn(),
  mintCsatEmailToken: vi.fn(),
  sendCsatRequestEmail: vi.fn(),
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  setTicketStatus,
  createTicketCore,
}))
vi.mock('@/lib/server/domains/tickets/ticket-conversation-link.service', () => ({
  linkTicketToConversation,
}))
vi.mock('@/lib/server/domains/inbox/inbox.query', () => ({ getLinkedCustomerTicket }))
vi.mock('@/lib/server/events/hook-context', () => ({ buildHookContext }))
vi.mock('@/lib/server/functions/csat-email', () => ({ mintCsatEmailToken }))
vi.mock('@quackback/email', () => ({ sendCsatRequestEmail }))

// executeCallConnectorNode's own dependencies: the connector row lookup +
// the shared HTTP executor (both mocked so this stays a unit test of the
// interpolation/coercion/routing logic, not a connector.execute integration
// test — that module has its own suite).
const { getConnectorRowForExecution, executeConnector } = vi.hoisted(() => ({
  getConnectorRowForExecution: vi.fn(),
  executeConnector: vi.fn(),
}))
vi.mock('@/lib/server/domains/connectors/connector.execute', () => ({
  getConnectorRowForExecution,
  executeConnector,
}))

// The connector call's own builtins ({customer.email} etc.) are resolved via
// a small local db lookup (see action.executor.ts's
// resolveConnectorRuntimeContextForConversation doc — replicated from
// connector.toolspec.ts's resolveRuntimeContext, not imported). Mocked at the
// db chain exactly like connector.toolspec.test.ts mocks the same query
// shape: select().from().innerJoin().leftJoin().where().limit().
const mockConnectorRuntimeRow = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  error: null as Error | null,
}))
const mockDbSelect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...original,
    db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  }
})

import { applyAction, executeCallConnectorNode, type WorkflowContext } from '../action.executor'

const conversationId = 'conversation_1' as ConversationId
const actor = {
  principalId: 'principal_a',
  role: 'admin',
  principalType: 'user',
} as unknown as Actor
const ctx: WorkflowContext = { conversationId, actor, runId: 'workflow_run_1' }

beforeEach(() => {
  vi.clearAllMocks()
  ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn' })
  resolveWorkflowVariables.mockResolvedValue({
    first_name: 'Jane',
    name: 'Jane Doe',
    email: 'jane@example.com',
    workspace_name: 'Acme',
  })
  getMessengerConfig.mockResolvedValue({ assistant: { name: 'Quinn', avatarUrl: null } })
  appendAssistantReply.mockResolvedValue({ id: 'conversation_message_block_1' })

  mockConnectorRuntimeRow.current = null
  mockConnectorRuntimeRow.error = null
  // A generic chainable stub (every drizzle verb no-ops back to itself,
  // terminal `.limit()` resolves the connector-runtime row) so it satisfies
  // every raw db.select shape this file's code under test can produce:
  // connector.toolspec's own .from().innerJoin().leftJoin().where().limit(),
  // AND the ticket-actions/CSAT-over-email additions' simpler
  // .from().where().limit() / .from().where().orderBy().limit() /
  // .from().leftJoin().where().limit() shapes. Individual tests below
  // override with mockImplementationOnce for their own specific rows.
  mockDbSelect.mockImplementation(() => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => {
        if (mockConnectorRuntimeRow.error) throw mockConnectorRuntimeRow.error
        return mockConnectorRuntimeRow.current ? [mockConnectorRuntimeRow.current] : []
      },
    }
    return chain
  })
})

/** A one-shot db.select chain resolving `rows` at `.limit()` — for the
 *  ticket-actions/CSAT-over-email tests below, queued via
 *  mockDbSelect.mockImplementationOnce in call order. */
function selectChainOnce(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  }
  return chain
}

describe('applyAction', () => {
  it('dispatches each state-change action to its service with the right args', async () => {
    expect(
      await applyAction({ type: 'assign_agent', principalId: 'principal_x' as PrincipalId }, ctx)
    ).toMatchObject({ label: 'assigned' })
    expect(assignConversation).toHaveBeenCalledWith(conversationId, 'principal_x', actor)

    expect(
      await applyAction({ type: 'assign_team', teamId: 'team_1' as TeamId }, ctx)
    ).toMatchObject({ label: 'assigned to team' })
    expect(assignTeam).toHaveBeenCalledWith(conversationId, 'team_1', actor)

    expect(
      await applyAction({ type: 'add_tag', tagId: 'ctag_1' as ConversationTagId }, ctx)
    ).toMatchObject({ label: 'tagged' })
    expect(attachTag).toHaveBeenCalledWith(conversationId, 'ctag_1')

    expect(
      await applyAction({ type: 'remove_tag', tagId: 'ctag_1' as ConversationTagId }, ctx)
    ).toMatchObject({ label: 'untagged' })
    expect(detachTag).toHaveBeenCalledWith(conversationId, 'ctag_1')

    expect(await applyAction({ type: 'set_priority', priority: 'high' }, ctx)).toMatchObject({
      label: 'priority high',
    })
    expect(setConversationPriority).toHaveBeenCalledWith(conversationId, 'high', actor)

    expect(await applyAction({ type: 'close' }, ctx)).toMatchObject({ label: 'closed' })
    expect(setConversationStatus).toHaveBeenCalledWith(conversationId, 'closed', actor)

    expect(await applyAction({ type: 'reopen' }, ctx)).toMatchObject({ label: 'reopened' })
    expect(setConversationStatus).toHaveBeenCalledWith(conversationId, 'open', actor)
  })

  describe('reopen (SF4)', () => {
    it('sets a closed conversation back to open via the same setConversationStatus seam close uses', async () => {
      setConversationStatus.mockResolvedValueOnce({ id: conversationId, status: 'open' })
      const result = await applyAction({ type: 'reopen' }, ctx)
      expect(result).toMatchObject({ label: 'reopened' })
      expect(setConversationStatus).toHaveBeenCalledWith(conversationId, 'open', actor)
    })

    it('delegates unconditionally (no pre-check) when the conversation is already open, exactly like `close` does for an already-closed one', async () => {
      // The executor itself never reads current status; it's a stateless
      // dispatch. The real "no-op" guarantee (no duplicate 'Conversation
      // reopened' transcript notice, no re-fired status_changed webhook) lives
      // in setConversationStatus's own pre-existing `status !== previous`
      // check (conversation.service.ts) — see the real-DB coverage in
      // conversation-status-reopen.test.ts.
      setConversationStatus.mockResolvedValueOnce({ id: conversationId, status: 'open' })
      const result = await applyAction({ type: 'reopen' }, ctx)
      expect(result).toMatchObject({ label: 'reopened' })
      expect(setConversationStatus).toHaveBeenCalledTimes(1)
      expect(setConversationStatus).toHaveBeenCalledWith(conversationId, 'open', actor)
    })
  })

  it('resolves the legacy serializable snooze wake time (or null) to a Date', async () => {
    const untilIso = '2026-01-06T09:00:00.000Z'
    expect(await applyAction({ type: 'snooze', untilIso }, ctx)).toMatchObject({
      label: 'snoozed',
    })
    expect(snoozeConversation).toHaveBeenCalledWith(conversationId, new Date(untilIso), actor)

    await applyAction({ type: 'snooze', untilIso: null }, ctx)
    expect(snoozeConversation).toHaveBeenLastCalledWith(conversationId, null, actor)
  })

  it('resolves a relative snooze to now + seconds, at execution time', async () => {
    const before = Date.now()
    expect(await applyAction({ type: 'snooze', seconds: 3600 }, ctx)).toMatchObject({
      label: 'snoozed',
    })
    const after = Date.now()

    expect(snoozeConversation).toHaveBeenCalledTimes(1)
    const wakeAt = snoozeConversation.mock.calls[0]![1] as Date
    expect(wakeAt).toBeInstanceOf(Date)
    // The wake time is now + 3600s, computed at the call — not any fixed,
    // stored instant — so it falls within [before, after] + 3600s.
    expect(wakeAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(wakeAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000)
    expect(snoozeConversation).toHaveBeenCalledWith(conversationId, wakeAt, actor)
  })

  it('resolves a zero-second relative snooze to (effectively) now, not null', async () => {
    await applyAction({ type: 'snooze', seconds: 0 }, ctx)
    const wakeAt = snoozeConversation.mock.calls[0]![1]
    expect(wakeAt).not.toBeNull()
    expect(wakeAt).toBeInstanceOf(Date)
  })

  it('applies an SLA policy through the SLA service', async () => {
    expect(
      await applyAction({ type: 'apply_sla', policyId: 'sla_policy_1' as SlaPolicyId }, ctx)
    ).toMatchObject({ label: 'SLA applied' })
    expect(applySlaToConversation).toHaveBeenCalledWith(conversationId, 'sla_policy_1')
  })

  it('applies set_attribute through the shared writer with actor-derived provenance', async () => {
    // A human actor (macros run as the invoking agent) records src teammate.
    expect(
      await applyAction({ type: 'set_attribute', key: 'plan', value: 'scale' }, ctx)
    ).toMatchObject({ label: 'set plan' })
    expect(setConversationAttribute).toHaveBeenCalledWith(
      { conversationId },
      'plan',
      'scale',
      'teammate'
    )

    // The engine's synthetic service actor records src workflow.
    const engineActor = {
      principalId: null,
      role: 'admin',
      principalType: 'service',
    } as unknown as Actor
    await applyAction(
      { type: 'set_attribute', key: 'plan', value: 7 },
      { conversationId, actor: engineActor }
    )
    expect(setConversationAttribute).toHaveBeenLastCalledWith(
      { conversationId },
      'plan',
      7,
      'workflow'
    )
  })

  it('an explicit src on set_attribute overrides the actor-derived default (the collect resume path)', async () => {
    const engineActor = {
      principalId: null,
      role: 'admin',
      principalType: 'service',
    } as unknown as Actor
    await applyAction(
      { type: 'set_attribute', key: 'email', value: 'visitor@example.com', src: 'customer' },
      { conversationId, actor: engineActor }
    )
    expect(setConversationAttribute).toHaveBeenCalledWith(
      { conversationId },
      'email',
      'visitor@example.com',
      'customer' // NOT 'workflow', despite the service actor
    )
  })

  it('propagates a service failure to the caller', async () => {
    setConversationStatus.mockRejectedValueOnce(new Error('boom'))
    await expect(applyAction({ type: 'close' }, ctx)).rejects.toThrow('boom')
  })

  describe('send_block', () => {
    const body = { type: 'doc', content: [{ type: 'text', text: 'Hi {first_name}!' }] }

    it('resolves variables, posts through appendAssistantReply as the assistant principal, and returns the message id', async () => {
      const result = await applyAction(
        { type: 'send_block', nodeId: 'n1', block: { kind: 'message', body } },
        ctx
      )
      expect(result).toMatchObject({
        label: 'sent message block',
        blockMessageId: 'conversation_message_block_1',
      })
      expect(ensureAssistantPrincipal).toHaveBeenCalled()
      expect(resolveWorkflowVariables).toHaveBeenCalledWith(conversationId)
      expect(appendAssistantReply).toHaveBeenCalledWith(
        conversationId,
        'Hi Jane!', // resolved plain-text fallback, no raw {token}
        { principalId: 'principal_quinn', displayName: 'Quinn', avatarUrl: null },
        expect.objectContaining({
          waiting: false,
          contentJson: { type: 'doc', content: [{ type: 'text', text: 'Hi Jane!' }] },
          metadata: {
            block: expect.objectContaining({
              v: 1,
              runId: 'workflow_run_1',
              nodeId: 'n1',
              waiting: false,
              kind: 'message',
            }),
          },
        })
      )
    })

    it('throws when applied outside a workflow run (no ctx.runId)', async () => {
      await expect(
        applyAction(
          { type: 'send_block', nodeId: 'n1', block: { kind: 'message', body } },
          { conversationId, actor }
        )
      ).rejects.toThrow(/workflow run/)
    })

    it('renders a buttons block honest fallback as a bracket list and marks it waiting', async () => {
      await applyAction(
        {
          type: 'send_block',
          nodeId: 'n2',
          block: {
            kind: 'buttons',
            body,
            options: [
              { key: 'yes', label: 'Yes' },
              { key: 'no', label: 'No' },
            ],
            allowTyping: false,
          },
        },
        ctx
      )
      const [, content, , opts] = appendAssistantReply.mock.calls[0]!
      expect(content).toBe('Hi Jane!\n[Yes] [No]')
      expect(opts.metadata.block).toMatchObject({
        kind: 'buttons',
        waiting: true,
        options: [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ],
        allowTyping: false,
      })
    })

    it('renders a csat block honest fallback as an emoji row and marks it waiting', async () => {
      await applyAction(
        {
          type: 'send_block',
          nodeId: 'n3',
          block: { kind: 'csat', body, allowTypingInterrupt: true, commentPrompt: 'Add a comment' },
        },
        ctx
      )
      const [, content, , opts] = appendAssistantReply.mock.calls[0]!
      expect(content).toContain('Hi Jane!')
      expect(content).toContain('😞')
      expect(content).toContain('😄')
      expect(opts.metadata.block).toMatchObject({
        kind: 'csat',
        waiting: true,
        allowTypingInterrupt: true,
        commentPrompt: 'Add a comment',
      })
    })

    it('marks collect and collectReply blocks as waiting with their attributeKey', async () => {
      await applyAction(
        {
          type: 'send_block',
          nodeId: 'n4',
          block: {
            kind: 'collect',
            body,
            attributeKey: 'email',
            fieldType: 'text',
            required: true,
          },
        },
        ctx
      )
      expect(appendAssistantReply.mock.calls[0]![3].metadata.block).toMatchObject({
        kind: 'collect',
        waiting: true,
        attributeKey: 'email',
        fieldType: 'text',
        required: true,
      })

      await applyAction(
        {
          type: 'send_block',
          nodeId: 'n5',
          block: { kind: 'collectReply', body, attributeKey: 'feedback' },
        },
        ctx
      )
      expect(appendAssistantReply.mock.calls[1]![3].metadata.block).toMatchObject({
        kind: 'collectReply',
        waiting: true,
        attributeKey: 'feedback',
      })
    })

    it('resolves a replyTime block from the office-hours service with no rich body and marks it not waiting', async () => {
      getOfficeHoursSchedule.mockResolvedValue({ enabled: true, timezone: 'UTC', intervals: [] })
      buildReplyTimeMessage.mockReturnValue({
        status: 'online',
        content: "We're online — typically replies in under an hour.",
      })
      const result = await applyAction(
        { type: 'send_block', nodeId: 'n6', block: { kind: 'replyTime' } },
        ctx
      )
      expect(result).toMatchObject({ label: 'sent replyTime block' })
      expect(resolveWorkflowVariables).not.toHaveBeenCalled() // no body to interpolate
      const [, content, , opts] = appendAssistantReply.mock.calls[0]!
      expect(content).toBe("We're online — typically replies in under an hour.")
      expect(opts.contentJson).toBeNull()
      expect(opts.metadata.block).toMatchObject({
        kind: 'replyTime',
        waiting: false,
        status: 'online',
      })
    })
  })

  describe('send_block csat -> CSAT-over-email', () => {
    const csatBody = { type: 'doc', content: [{ type: 'text', text: 'How did we do?' }] }
    const csatAction = {
      type: 'send_block' as const,
      nodeId: 'n_csat',
      block: { kind: 'csat' as const, body: csatBody, allowTypingInterrupt: true },
    }

    it('does not send an email when the conversation channel is not email', async () => {
      mockDbSelect.mockImplementationOnce(() =>
        selectChainOnce([{ channel: 'messenger', visitorPrincipalId: 'principal_visitor' }])
      )
      await applyAction(csatAction, ctx)
      expect(sendCsatRequestEmail).not.toHaveBeenCalled()
    })

    it('does not send an email when the conversation has no visitor principal', async () => {
      mockDbSelect.mockImplementationOnce(() =>
        selectChainOnce([{ channel: 'email', visitorPrincipalId: null }])
      )
      await applyAction(csatAction, ctx)
      expect(sendCsatRequestEmail).not.toHaveBeenCalled()
    })

    it('sends the CSAT-over-email request when the channel is email and the visitor is reachable', async () => {
      mockDbSelect
        .mockImplementationOnce(() =>
          selectChainOnce([{ channel: 'email', visitorPrincipalId: 'principal_visitor' }])
        )
        .mockImplementationOnce(() =>
          selectChainOnce([{ type: 'user', email: 'visitor@example.com', contactEmail: null }])
        )
      buildHookContext.mockResolvedValue({
        workspaceName: 'Acme',
        portalBaseUrl: 'https://acme.example.com',
        logoUrl: null,
      })
      mintCsatEmailToken.mockReturnValue('signed-token')
      sendCsatRequestEmail.mockResolvedValue({ sent: true })

      const result = await applyAction(csatAction, ctx)
      expect(result).toMatchObject({ label: 'sent csat block' })

      expect(mintCsatEmailToken).toHaveBeenCalledWith(conversationId, 'principal_visitor')
      expect(sendCsatRequestEmail).toHaveBeenCalledWith({
        to: 'visitor@example.com',
        promptText: 'How did we do?',
        ratingUrls: [
          'https://acme.example.com/csat?token=signed-token&rating=1',
          'https://acme.example.com/csat?token=signed-token&rating=2',
          'https://acme.example.com/csat?token=signed-token&rating=3',
          'https://acme.example.com/csat?token=signed-token&rating=4',
          'https://acme.example.com/csat?token=signed-token&rating=5',
        ],
        workspaceName: 'Acme',
        logoUrl: undefined,
      })
    })

    it('never fails the block send when the email send itself throws (best-effort)', async () => {
      mockDbSelect
        .mockImplementationOnce(() =>
          selectChainOnce([{ channel: 'email', visitorPrincipalId: 'principal_visitor' }])
        )
        .mockImplementationOnce(() =>
          selectChainOnce([{ type: 'user', email: 'visitor@example.com', contactEmail: null }])
        )
      buildHookContext.mockResolvedValue({
        workspaceName: 'Acme',
        portalBaseUrl: 'https://acme.example.com',
        logoUrl: null,
      })
      mintCsatEmailToken.mockReturnValue('signed-token')
      sendCsatRequestEmail.mockRejectedValue(new Error('provider down'))

      const result = await applyAction(csatAction, ctx)
      expect(result).toMatchObject({ label: 'sent csat block' })
    })
  })

  describe('let_assistant_answer', () => {
    it('hands the turn to Quinn out-of-band and returns immediately', async () => {
      let resolveTurn: () => void = () => {}
      runAssistantTurnForConversation.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveTurn = resolve
        })
      )
      const result = await applyAction({ type: 'let_assistant_answer' }, ctx)
      expect(result).toMatchObject({ label: 'handed to assistant' })
      // The action already resolved even though the assistant's own turn has
      // not — the dynamic import + call happen on a later microtask, so wait
      // for it rather than asserting synchronously.
      await vi.waitFor(() =>
        expect(runAssistantTurnForConversation).toHaveBeenCalledWith(conversationId, {
          stepInstructions: undefined,
        })
      )
      resolveTurn()
    })

    it('Phase C, slice C-6: a node-authored instructions field reaches runAssistantTurnForConversation as stepInstructions', async () => {
      runAssistantTurnForConversation.mockResolvedValue(undefined)
      await applyAction(
        { type: 'let_assistant_answer', instructions: 'Focus only on billing questions' },
        ctx
      )
      await vi.waitFor(() =>
        expect(runAssistantTurnForConversation).toHaveBeenCalledWith(conversationId, {
          stepInstructions: 'Focus only on billing questions',
        })
      )
    })

    it('never throws into the caller when the assistant turn itself fails', async () => {
      runAssistantTurnForConversation.mockRejectedValue(new Error('llm down'))
      await expect(applyAction({ type: 'let_assistant_answer' }, ctx)).resolves.toMatchObject({
        label: 'handed to assistant',
      })
    })
  })

  describe('record_csat', () => {
    it('records through the shared recordCsat writer with the given actor (the engine passes a visitor actor)', async () => {
      const visitorActor = {
        principalId: 'principal_visitor',
        role: null,
        principalType: 'anonymous',
      } as unknown as Actor
      expect(
        await applyAction(
          { type: 'record_csat', rating: 5, comment: 'Great!' },
          { conversationId, actor: visitorActor }
        )
      ).toMatchObject({ label: 'csat recorded' })
      expect(recordCsat).toHaveBeenCalledWith(conversationId, 5, 'Great!', visitorActor)
    })
  })

  describe('add_note', () => {
    it('posts through the shared addAgentNote seam, authored by the assistant service principal, under the run actor', async () => {
      ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
      addAgentNote.mockResolvedValue({
        conversation: { id: conversationId },
        message: { id: 'conversation_message_note_1' },
      })
      expect(await applyAction({ type: 'add_note', body: 'Escalated to VIP' }, ctx)).toMatchObject({
        label: 'note added',
      })
      expect(addAgentNote).toHaveBeenCalledWith(
        conversationId,
        'Escalated to VIP',
        { principalId: 'principal_quinn', displayName: 'Quinn' },
        actor
      )
    })

    it('propagates a failure from the note write path (e.g. an empty/over-long body slipping past the schema)', async () => {
      ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn', displayName: 'Quinn' })
      addAgentNote.mockRejectedValue(new Error('Message cannot be empty'))
      await expect(applyAction({ type: 'add_note', body: '' }, ctx)).rejects.toThrow(
        'Message cannot be empty'
      )
    })
  })

  describe('set_ticket_status', () => {
    it('resolves the linked customer ticket and calls setTicketStatus with a locally widened service actor', async () => {
      getLinkedCustomerTicket.mockResolvedValue({
        id: 'ticket_1',
        number: 1,
        statusName: 'Open',
        statusCategory: 'open',
      })
      setTicketStatus.mockResolvedValue({ id: 'ticket_1' })
      const engineActor = {
        principalId: null,
        role: 'admin',
        principalType: 'service',
        permissions: new Set(['conversation.view']),
      } as unknown as Actor

      const result = await applyAction(
        { type: 'set_ticket_status', statusId: 'ticket_status_1' as never },
        { conversationId, actor: engineActor }
      )
      expect(result).toMatchObject({ label: 'ticket status updated' })
      expect(getLinkedCustomerTicket).toHaveBeenCalledWith(conversationId)
      expect(setTicketStatus).toHaveBeenCalledTimes(1)
      const [ticketIdArg, statusIdArg, actorArg] = setTicketStatus.mock.calls[0]!
      expect(ticketIdArg).toBe('ticket_1')
      expect(statusIdArg).toBe('ticket_status_1')
      // Widened locally: the engine's own service actor gains the two ticket
      // permissions without losing whatever it already had.
      expect(actorArg.principalType).toBe('service')
      expect(actorArg.permissions.has('conversation.view')).toBe(true)
      expect(actorArg.permissions.has('ticket.set_status')).toBe(true)
      expect(actorArg.permissions.has('ticket.create')).toBe(true)
    })

    it('passes a human actor through unchanged (no widening)', async () => {
      getLinkedCustomerTicket.mockResolvedValue({ id: 'ticket_1' })
      setTicketStatus.mockResolvedValue({ id: 'ticket_1' })
      await applyAction({ type: 'set_ticket_status', statusId: 'ticket_status_1' as never }, ctx)
      const [, , actorArg] = setTicketStatus.mock.calls[0]!
      expect(actorArg).toBe(actor)
    })

    it('throws when the conversation has no linked ticket (the engine logs action_failed and continues)', async () => {
      getLinkedCustomerTicket.mockResolvedValue(null)
      await expect(
        applyAction({ type: 'set_ticket_status', statusId: 'ticket_status_1' as never }, ctx)
      ).rejects.toThrow(NotFoundError)
      expect(setTicketStatus).not.toHaveBeenCalled()
    })
  })

  describe('convert_to_ticket', () => {
    it('is a no-op when the conversation already has a linked customer ticket', async () => {
      getLinkedCustomerTicket.mockResolvedValue({
        id: 'ticket_1',
        number: 1,
        statusName: 'Open',
        statusCategory: 'open',
      })
      const result = await applyAction({ type: 'convert_to_ticket' }, ctx)
      expect(result).toMatchObject({ label: 'already a ticket' })
      expect(createTicketCore).not.toHaveBeenCalled()
      expect(linkTicketToConversation).not.toHaveBeenCalled()
    })

    it('creates a customer ticket from the conversation subject and links it, when unlinked', async () => {
      getLinkedCustomerTicket.mockResolvedValue(null)
      mockDbSelect.mockImplementationOnce(() =>
        selectChainOnce([{ subject: 'Cannot log in', visitorPrincipalId: 'principal_visitor' }])
      )
      createTicketCore.mockResolvedValue({ id: 'ticket_2' })

      const engineActor = {
        principalId: null,
        role: 'admin',
        principalType: 'service',
      } as unknown as Actor
      const result = await applyAction(
        { type: 'convert_to_ticket' },
        { conversationId, actor: engineActor }
      )
      expect(result).toMatchObject({ label: 'converted to ticket' })
      expect(createTicketCore).toHaveBeenCalledWith(
        { type: 'customer', title: 'Cannot log in', requesterPrincipalId: 'principal_visitor' },
        expect.objectContaining({ principalType: 'service' })
      )
      expect(linkTicketToConversation).toHaveBeenCalledWith(
        'ticket_2',
        conversationId,
        expect.objectContaining({ principalType: 'service' })
      )
    })

    it('falls back to the first visitor message excerpt when the conversation has no subject', async () => {
      getLinkedCustomerTicket.mockResolvedValue(null)
      mockDbSelect
        .mockImplementationOnce(() =>
          selectChainOnce([{ subject: null, visitorPrincipalId: 'principal_visitor' }])
        )
        .mockImplementationOnce(() => selectChainOnce([{ content: 'Hi, my account is locked' }]))
      createTicketCore.mockResolvedValue({ id: 'ticket_3' })

      await applyAction({ type: 'convert_to_ticket' }, ctx)
      expect(createTicketCore).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Hi, my account is locked' }),
        expect.anything()
      )
    })
  })
})

// call_connector is NOT a WorkflowAction (see the module doc's new section) —
// workflow.engine.ts calls this directly, not through applyAction. Covered
// here as its own unit: connector-row lookup, param interpolation + type
// coercion, and the never-throws contract.
describe('executeCallConnectorNode', () => {
  const connectorId = 'data_connector_1' as DataConnectorId

  function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: connectorId,
      enabled: true,
      status: 'active',
      timeoutMs: 10000,
      inputs: [
        { name: 'ticket_id', type: 'string', required: true },
        { name: 'priority', type: 'number', required: false },
        { name: 'urgent', type: 'boolean', required: false },
      ],
      ...overrides,
    }
  }

  it('returns { ok: true } and calls executeConnector with interpolated + coerced values when the connector exists and is enabled', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow())
    executeConnector.mockResolvedValue({ ok: true, status: 200, data: {} })
    resolveWorkflowVariables.mockResolvedValue({
      first_name: 'Jane',
      name: 'Jane Doe',
      email: 'jane@example.com',
      workspace_name: 'Acme',
    })

    const result = await executeCallConnectorNode(conversationId, {
      connectorId,
      params: { ticket_id: '{first_name|there}-42', priority: '3', urgent: 'TRUE' },
    })

    expect(result).toEqual({ ok: true })
    expect(getConnectorRowForExecution).toHaveBeenCalledWith(connectorId)
    expect(executeConnector).toHaveBeenCalledTimes(1)
    const [row, values] = executeConnector.mock.calls[0]!
    expect(row).toEqual(baseRow())
    expect(values).toEqual({ ticket_id: 'Jane-42', priority: 3, urgent: true })
  })

  it('threads the conversation visitor as ConnectorRuntimeContext (customer.email/name builtins)', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow({ inputs: [] }))
    executeConnector.mockResolvedValue({ ok: true, status: 200, data: {} })
    mockConnectorRuntimeRow.current = {
      displayName: 'Jane Doe',
      contactEmail: 'jane@example.com',
      userName: null,
      userEmail: null,
    }

    await executeCallConnectorNode(conversationId, { connectorId, params: {} })

    const [, , runtimeCtx] = executeConnector.mock.calls[0]!
    expect(runtimeCtx).toMatchObject({
      customerEmail: 'jane@example.com',
      customerName: 'Jane Doe',
      conversationId,
    })
  })

  it('a runtime-context lookup failure degrades to a conversationId-only context rather than throwing (never a reason to fail the call)', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow({ inputs: [] }))
    executeConnector.mockResolvedValue({ ok: true, status: 200, data: {} })
    mockConnectorRuntimeRow.error = new Error('db blip')

    const result = await executeCallConnectorNode(conversationId, { connectorId, params: {} })

    expect(result).toEqual({ ok: true })
    const [, , runtimeCtx] = executeConnector.mock.calls[0]!
    expect(runtimeCtx).toEqual({ conversationId })
  })

  it('clamps an out-of-bounds timeoutMs override to [1, 30000] before passing it to executeConnector', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow({ inputs: [] }))
    executeConnector.mockResolvedValue({ ok: true, status: 200, data: {} })

    await executeCallConnectorNode(conversationId, { connectorId, params: {}, timeoutMs: 999999 })
    expect(executeConnector.mock.calls[0]![3]).toBe(30000)

    await executeCallConnectorNode(conversationId, { connectorId, params: {}, timeoutMs: -5 })
    expect(executeConnector.mock.calls[1]![3]).toBe(1)

    await executeCallConnectorNode(conversationId, { connectorId, params: {}, timeoutMs: 2500 })
    expect(executeConnector.mock.calls[2]![3]).toBe(2500)

    await executeCallConnectorNode(conversationId, { connectorId, params: {} })
    expect(executeConnector.mock.calls[3]![3]).toBeUndefined()
  })

  it('reason "unavailable" when the connector no longer exists (getConnectorRowForExecution throws NotFoundError) — never propagates the throw', async () => {
    getConnectorRowForExecution.mockRejectedValue(
      new NotFoundError('CONNECTOR_NOT_FOUND', 'Connector not found')
    )
    const result = await executeCallConnectorNode(conversationId, { connectorId, params: {} })
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
    expect(executeConnector).not.toHaveBeenCalled()
  })

  it('re-throws a non-NotFoundError from the row lookup (a genuine infra failure, not a routing outcome)', async () => {
    getConnectorRowForExecution.mockRejectedValue(new Error('db unreachable'))
    await expect(
      executeCallConnectorNode(conversationId, { connectorId, params: {} })
    ).rejects.toThrow('db unreachable')
  })

  it('reason "unavailable" when the connector is disabled or its circuit breaker has tripped it to disabled status', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow({ enabled: false }))
    expect(await executeCallConnectorNode(conversationId, { connectorId, params: {} })).toEqual({
      ok: false,
      reason: 'unavailable',
    })

    getConnectorRowForExecution.mockResolvedValue(baseRow({ status: 'disabled' }))
    expect(await executeCallConnectorNode(conversationId, { connectorId, params: {} })).toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(executeConnector).not.toHaveBeenCalled()
  })

  it('reason "invalid_params" when a required string input resolves empty (no value and no fallback)', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow())
    resolveWorkflowVariables.mockResolvedValue({
      first_name: '',
      name: '',
      email: '',
      workspace_name: '',
    })
    const result = await executeCallConnectorNode(conversationId, {
      connectorId,
      params: { ticket_id: '{first_name}' }, // no fallback, and the variable is empty
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_params' })
    expect(executeConnector).not.toHaveBeenCalled()
  })

  it('reason "invalid_params" when a required number input does not parse', async () => {
    getConnectorRowForExecution.mockResolvedValue(
      baseRow({ inputs: [{ name: 'count', type: 'number', required: true }] })
    )
    const result = await executeCallConnectorNode(conversationId, {
      connectorId,
      params: { count: 'not-a-number' },
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_params' })
    expect(executeConnector).not.toHaveBeenCalled()
  })

  it('reason "invalid_params" when a required boolean input is neither "true" nor "false"', async () => {
    getConnectorRowForExecution.mockResolvedValue(
      baseRow({ inputs: [{ name: 'flag', type: 'boolean', required: true }] })
    )
    const result = await executeCallConnectorNode(conversationId, {
      connectorId,
      params: { flag: 'maybe' },
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_params' })
    expect(executeConnector).not.toHaveBeenCalled()
  })

  it('an unresolved OPTIONAL input is simply omitted from values, not a failure', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow())
    executeConnector.mockResolvedValue({ ok: true, status: 200, data: {} })
    resolveWorkflowVariables.mockResolvedValue({
      first_name: 'Jane',
      name: '',
      email: '',
      workspace_name: '',
    })
    // priority/urgent are optional and left unmapped entirely.
    await executeCallConnectorNode(conversationId, {
      connectorId,
      params: { ticket_id: '{first_name}' },
    })
    const [, values] = executeConnector.mock.calls[0]!
    expect(values).toEqual({ ticket_id: 'Jane' })
  })

  it('passes through every ConnectorExecutionResult failure reason from executeConnector verbatim', async () => {
    getConnectorRowForExecution.mockResolvedValue(baseRow({ inputs: [] }))
    for (const reason of ['rate_limited', 'host_not_allowed', 'http_error', 'network_error']) {
      executeConnector.mockResolvedValueOnce({ ok: false, reason })
      const result = await executeCallConnectorNode(conversationId, { connectorId, params: {} })
      expect(result).toEqual({ ok: false, reason })
    }
  })
})
