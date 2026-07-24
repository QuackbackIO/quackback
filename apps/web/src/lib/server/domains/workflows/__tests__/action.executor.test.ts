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
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'

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
  applySlaToTicket,
  setConversationAttribute,
  ensureAssistantPrincipal,
  resolveWorkflowVariables,
  getAssistantRuntimeConfig,
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
  applySlaToTicket: vi.fn(),
  setConversationAttribute: vi.fn(),
  ensureAssistantPrincipal: vi.fn(),
  resolveWorkflowVariables: vi.fn(),
  getAssistantRuntimeConfig: vi.fn(),
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
vi.mock('@/lib/server/domains/sla/ticket-sla.service', () => ({ applySlaToTicket }))
vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute,
}))
vi.mock('@/lib/server/domains/assistant/assistant.principal', () => ({ ensureAssistantPrincipal }))
vi.mock('../workflow-variables', () => ({ resolveWorkflowVariables }))
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({ getAssistantRuntimeConfig }))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({ getOfficeHoursSchedule }))
vi.mock('@/lib/server/domains/office-hours/reply-time-message', () => ({ buildReplyTimeMessage }))
vi.mock('@/lib/server/domains/assistant/assistant.orchestrator', () => ({
  runAssistantTurnForConversation,
}))

const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/server/content/ssrf-guard', () => ({ safeFetch }))

// Ticket actions (set_ticket_status / convert_to_ticket) — each mocked at its
// own seam so this stays a unit test of action.executor.ts's dispatch/
// resolution logic, not an integration test of the tickets domain.
const {
  setTicketStatus,
  createTicketCore,
  linkTicketToConversation,
  getLinkedCustomerTicket,
  resolveTicketTypeForCreate,
  resolveCategoryDefaultType,
} = vi.hoisted(() => ({
  setTicketStatus: vi.fn(),
  createTicketCore: vi.fn(),
  linkTicketToConversation: vi.fn(),
  getLinkedCustomerTicket: vi.fn(),
  resolveTicketTypeForCreate: vi.fn(),
  resolveCategoryDefaultType: vi.fn(),
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  setTicketStatus,
  createTicketCore,
}))
vi.mock('@/lib/server/domains/tickets/ticket-type.service', () => ({
  resolveTicketTypeForCreate,
  resolveCategoryDefaultType,
}))
vi.mock('@/lib/server/domains/tickets/ticket-conversation-link.service', () => ({
  linkTicketToConversation,
}))
vi.mock('@/lib/server/domains/inbox/inbox.query', () => ({ getLinkedCustomerTicket }))

// CSAT-over-email itself now lives in conversation.notify.ts's
// notifyCsatRequestEmail (action.executor.ts's send_block csat case only
// dynamic-imports and calls it, best-effort) — the channel-gating/recipient-
// resolution/email-template behavior is covered by that module's own suite
// (conversation-notify.test.ts); this file only pins the dispatch + the
// best-effort catch.
const { notifyCsatRequestEmail } = vi.hoisted(() => ({ notifyCsatRequestEmail: vi.fn() }))
vi.mock('@/lib/server/domains/conversation/conversation.notify', () => ({ notifyCsatRequestEmail }))

const mockDbSelect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...original,
    db: {
      select: (...args: unknown[]) => mockDbSelect(...args),
    },
  }
})

// The funnel's `block_sent` ledger write now goes through the shared
// workflow-run-events.ts module (moved there so both this executor and the
// engine can write to the timeline without an import cycle — see
// WorkflowContext's doc) rather than a hand-rolled run-row lookup + insert
// in this module, so it's mocked at that seam instead of at the db chain.
const { logRunEvent } = vi.hoisted(() => ({ logRunEvent: vi.fn() }))
vi.mock('../workflow-run-events', () => ({ logRunEvent }))

import { applyAction, type WorkflowContext } from '../action.executor'

const conversationId = 'conversation_1' as ConversationId
const actor = {
  principalId: 'principal_a',
  role: 'admin',
  principalType: 'user',
} as unknown as Actor
const ctx: WorkflowContext = {
  conversationId,
  actor,
  runId: 'workflow_run_1',
  workflowId: 'workflow_abc',
  subjectPrincipalId: 'principal_x' as PrincipalId,
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn' })
  resolveWorkflowVariables.mockResolvedValue({
    first_name: 'Jane',
    name: 'Jane Doe',
    email: 'jane@example.com',
    workspace_name: 'Acme',
  })
  getAssistantRuntimeConfig.mockResolvedValue({
    config: { identity: { name: 'Quinn', avatarUrl: null } },
  })
  appendAssistantReply.mockResolvedValue({ id: 'conversation_message_block_1' })
  safeFetch.mockResolvedValue({ ok: true, status: 200 })
  // convert_to_ticket's Phase 4 type resolution: the customer-category default
  // exists (the 0215 seed) and an explicit type resolves to itself.
  resolveCategoryDefaultType.mockResolvedValue({ id: 'ticket_type_cust_default' })
  resolveTicketTypeForCreate.mockImplementation(
    async ({ ticketTypeId, category }: { ticketTypeId: string; category?: string }) => ({
      category: category ?? 'customer',
      ticketTypeId,
    })
  )

  // A generic chainable stub satisfying every raw db.select shape this file's
  // code under test can produce. Individual tests below override it with
  // mockImplementationOnce for their own specific rows.
  mockDbSelect.mockImplementation(() => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => [],
    }
    return chain
  })
})

/** A one-shot db.select chain resolving `rows` at `.limit()` — for the
 *  ticket-actions tests below, queued via mockDbSelect.mockImplementationOnce
 *  in call order. */
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
  it('sends workflow webhooks with a stable delivery identity and run context', async () => {
    await expect(
      applyAction(
        {
          type: 'send_webhook',
          url: 'https://example.test/hook',
          nodeId: 'action_webhook',
        },
        ctx
      )
    ).resolves.toMatchObject({ label: 'webhook sent' })

    expect(safeFetch).toHaveBeenCalledOnce()
    const [, options] = safeFetch.mock.calls[0]
    expect(options.headers).toMatchObject({
      'X-Quackback-Delivery-Id': 'workflow:workflow_run_1:action_webhook',
      'Idempotency-Key': 'workflow:workflow_run_1:action_webhook',
    })
    expect(JSON.parse(options.body)).toMatchObject({
      id: 'workflow:workflow_run_1:action_webhook',
      type: 'workflow.send_webhook',
      data: {
        conversationId,
        workflowId: 'workflow_abc',
        runId: 'workflow_run_1',
        actionId: 'action_webhook',
      },
    })
  })

  it('refuses to send a workflow webhook without a stable action identity', async () => {
    await expect(
      applyAction({ type: 'send_webhook', url: 'https://example.test/hook' }, ctx)
    ).rejects.toThrow('requires workflow run and action identity')
    expect(safeFetch).not.toHaveBeenCalled()
  })

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
    expect(applySlaToTicket).not.toHaveBeenCalled()
  })

  it('apply_sla with an explicit conversation target behaves like the default', async () => {
    expect(
      await applyAction(
        {
          type: 'apply_sla',
          policyId: 'sla_policy_1' as SlaPolicyId,
          target: 'conversation',
        },
        ctx
      )
    ).toMatchObject({ label: 'SLA applied' })
    expect(applySlaToConversation).toHaveBeenCalledWith(conversationId, 'sla_policy_1')
    expect(applySlaToTicket).not.toHaveBeenCalled()
  })

  it("apply_sla with a ticket target stamps the conversation's linked customer ticket", async () => {
    getLinkedCustomerTicket.mockResolvedValueOnce({ id: 'ticket_1' })
    expect(
      await applyAction(
        { type: 'apply_sla', policyId: 'sla_policy_1' as SlaPolicyId, target: 'ticket' },
        ctx
      )
    ).toMatchObject({ label: 'SLA applied to ticket' })
    expect(applySlaToTicket).toHaveBeenCalledWith('ticket_1', 'sla_policy_1')
    expect(applySlaToConversation).not.toHaveBeenCalled()
  })

  it('apply_sla with a ticket target is a no-op success when no ticket is linked', async () => {
    getLinkedCustomerTicket.mockResolvedValueOnce(null)
    expect(
      await applyAction(
        { type: 'apply_sla', policyId: 'sla_policy_1' as SlaPolicyId, target: 'ticket' },
        ctx
      )
    ).toMatchObject({ label: null })
    expect(applySlaToTicket).not.toHaveBeenCalled()
    expect(applySlaToConversation).not.toHaveBeenCalled()
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
      // Never even attempts the funnel's block_sent ledger write when there's
      // no run to log it against.
      expect(logRunEvent).not.toHaveBeenCalled()
    })

    describe('funnel: block_sent event', () => {
      it('logs a block_sent event via logRunEvent, keyed on ctx.workflowId/subjectPrincipalId', async () => {
        await applyAction(
          { type: 'send_block', nodeId: 'n1', block: { kind: 'message', body } },
          ctx
        )

        expect(logRunEvent).toHaveBeenCalledWith(
          'workflow_run_1',
          'workflow_abc',
          'principal_x',
          'block_sent'
        )
      })

      it('is best-effort: a ledger write failure never fails the block send', async () => {
        logRunEvent.mockRejectedValueOnce(new Error('db down'))

        const result = await applyAction(
          { type: 'send_block', nodeId: 'n1', block: { kind: 'message', body } },
          ctx
        )
        expect(result).toMatchObject({ label: 'sent message block' })
      })

      it('is guarded: skips the funnel write when ctx carries no workflowId', async () => {
        await applyAction(
          { type: 'send_block', nodeId: 'n1', block: { kind: 'message', body } },
          { conversationId, actor, runId: 'workflow_run_1' }
        )
        expect(logRunEvent).not.toHaveBeenCalled()
      })
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

    // CSAT once per pair: conversation.status_changed and
    // ticket.status_changed are independent triggers with no cross-dedup, so
    // a workspace authoring CSAT on both axes reaches send_block twice for
    // one pair — the guard skips the second ask instead of double-prompting.
    describe('csat once per pair (the guard)', () => {
      const csatAction = {
        type: 'send_block' as const,
        nodeId: 'n9',
        block: { kind: 'csat' as const, body, allowTypingInterrupt: true, commentPrompt: '' },
      }

      it('skips (without parking) when the conversation already has a rating on file', async () => {
        mockDbSelect.mockImplementationOnce(() => selectChainOnce([{ csatRating: 4 }]))
        const res = await applyAction(csatAction, ctx)
        expect(res.label).toContain('skipped')
        expect(res.blockMessageId).toBeUndefined()
        expect(appendAssistantReply).not.toHaveBeenCalled()
      })

      it('skips when an earlier csat block is already pending on the thread', async () => {
        mockDbSelect
          .mockImplementationOnce(() => selectChainOnce([{ csatRating: null }]))
          .mockImplementationOnce(() => selectChainOnce([{ id: 'conversation_message_prior' }]))
        const res = await applyAction(csatAction, ctx)
        expect(res.label).toContain('skipped')
        expect(appendAssistantReply).not.toHaveBeenCalled()
      })

      it('asks normally when the conversation has neither a rating nor a pending ask', async () => {
        // The default select stub resolves [] for both guard reads.
        const res = await applyAction(csatAction, ctx)
        expect(res.blockMessageId).toBe('conversation_message_block_1')
        expect(appendAssistantReply).toHaveBeenCalledTimes(1)
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

  // The channel-gating/recipient-resolution/email-template behavior itself
  // now lives in conversation.notify.ts's notifyCsatRequestEmail (see its own
  // suite, conversation-notify.test.ts) — this only pins that the csat
  // send_block path calls it (via dynamic import) with the right args, and
  // that a throw there is swallowed (best-effort), same as it always was.
  describe('send_block csat -> CSAT-over-email (delegates to conversation.notify.ts)', () => {
    const csatBody = { type: 'doc', content: [{ type: 'text', text: 'How did we do?' }] }
    const csatAction = {
      type: 'send_block' as const,
      nodeId: 'n_csat',
      block: { kind: 'csat' as const, body: csatBody, allowTypingInterrupt: true },
    }

    it('calls notifyCsatRequestEmail with the conversation id and the resolved plain-text prompt', async () => {
      notifyCsatRequestEmail.mockResolvedValue(undefined)

      const result = await applyAction(csatAction, ctx)
      expect(result).toMatchObject({ label: 'sent csat block' })
      expect(notifyCsatRequestEmail).toHaveBeenCalledWith(conversationId, 'How did we do?')
    })

    it('never fails the block send when notifyCsatRequestEmail itself throws (best-effort)', async () => {
      notifyCsatRequestEmail.mockRejectedValue(new Error('provider down'))

      const result = await applyAction(csatAction, ctx)
      expect(result).toMatchObject({ label: 'sent csat block' })
    })

    it('is not called for a non-csat block kind', async () => {
      await applyAction(
        {
          type: 'send_block' as const,
          nodeId: 'n_msg',
          block: { kind: 'message' as const, body: csatBody },
        },
        ctx
      )
      expect(notifyCsatRequestEmail).not.toHaveBeenCalled()
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
          surface: 'workflow_step',
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
          surface: 'workflow_step',
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
    // The deriveTicketOpeningFields stub shared by the create-path cases.
    const subjectRow = [{ subject: 'Cannot log in', visitorPrincipalId: 'principal_visitor' }]

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
      mockDbSelect.mockImplementationOnce(() => selectChainOnce(subjectRow))
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
      // Absent ticketTypeId = the customer-category default type (Phase 4) —
      // existing graphs convert exactly as before.
      expect(createTicketCore).toHaveBeenCalledWith(
        {
          ticketTypeId: 'ticket_type_cust_default',
          title: 'Cannot log in',
          requesterPrincipalId: 'principal_visitor',
        },
        expect.objectContaining({ principalType: 'service' })
      )
      expect(linkTicketToConversation).toHaveBeenCalledWith(
        'ticket_2',
        conversationId,
        expect.objectContaining({ principalType: 'service' })
      )
    })

    it('files the configured registry type when ticketTypeId is set (category checked server-side)', async () => {
      getLinkedCustomerTicket.mockResolvedValue(null)
      mockDbSelect.mockImplementationOnce(() => selectChainOnce(subjectRow))
      createTicketCore.mockResolvedValue({ id: 'ticket_4' })

      await applyAction({ type: 'convert_to_ticket', ticketTypeId: 'ticket_type_bug' }, ctx)
      // The type is validated against the customer category before the create.
      expect(resolveTicketTypeForCreate).toHaveBeenCalledWith({
        ticketTypeId: 'ticket_type_bug',
        category: 'customer',
      })
      expect(createTicketCore).toHaveBeenCalledWith(
        expect.objectContaining({ ticketTypeId: 'ticket_type_bug' }),
        expect.anything()
      )
    })

    it('fails the run loudly when the configured type is not a live customer type', async () => {
      getLinkedCustomerTicket.mockResolvedValue(null)
      mockDbSelect.mockImplementationOnce(() => selectChainOnce(subjectRow))
      resolveTicketTypeForCreate.mockRejectedValue(
        new ValidationError('TICKET_TYPE_CATEGORY_MISMATCH', 'belongs to back_office')
      )

      await expect(
        applyAction({ type: 'convert_to_ticket', ticketTypeId: 'ticket_type_internal' }, ctx)
      ).rejects.toThrow(ValidationError)
      expect(createTicketCore).not.toHaveBeenCalled()
      expect(linkTicketToConversation).not.toHaveBeenCalled()
    })

    it('converts legacy-typeless when the workspace has no customer-category default type', async () => {
      getLinkedCustomerTicket.mockResolvedValue(null)
      resolveCategoryDefaultType.mockResolvedValue(null)
      mockDbSelect.mockImplementationOnce(() => selectChainOnce(subjectRow))
      createTicketCore.mockResolvedValue({ id: 'ticket_5' })

      await applyAction({ type: 'convert_to_ticket' }, ctx)
      expect(createTicketCore).toHaveBeenCalledWith(
        expect.objectContaining({ ticketTypeId: null }),
        expect.anything()
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
