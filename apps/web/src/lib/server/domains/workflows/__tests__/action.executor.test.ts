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

import { applyAction, type WorkflowContext } from '../action.executor'

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
})

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
})
