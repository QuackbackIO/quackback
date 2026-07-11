/**
 * Coverage for dispatchWorkflowsForEvent's interrupt-then-dispatch ordering
 * (§4.6): a reply or close interrupts pending waits BEFORE new workflows start;
 * other events don't interrupt. The dispatcher + engine are mocked so this pins
 * only the ordering + gating.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const {
  dispatchWorkflowTrigger,
  interruptWaitingRuns,
  resumeWorkflowRun,
  findWaitingCustomerFacingRun,
  readMessageBlockReply,
} = vi.hoisted(() => ({
  dispatchWorkflowTrigger: vi.fn(),
  interruptWaitingRuns: vi.fn(),
  resumeWorkflowRun: vi.fn(),
  findWaitingCustomerFacingRun: vi.fn(),
  readMessageBlockReply: vi.fn(),
}))
vi.mock('../dispatcher', () => ({ dispatchWorkflowTrigger }))
vi.mock('../workflow.engine', () => ({ interruptWaitingRuns, resumeWorkflowRun }))
// No waiting run by default: every pre-existing test in this file exercises a
// message with no parked customer-facing run to match against, so the
// resume-vs-interrupt check falls through to the interrupt path exactly as
// before it existed.
vi.mock('../dispatcher.guards', () => ({ findWaitingCustomerFacingRun, readMessageBlockReply }))

// Ticket triggers' own async pre-resolution (resolveTicketConversationId):
// one indexed ticket_conversations lookup, mocked at the db chain — every
// pre-existing test above never touches this (no ticket event).
const mockTicketConversationRow = vi.hoisted(() => ({
  current: null as { conversationId: string } | null,
}))
const mockDbSelect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...original,
    db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  }
})

import { dispatchWorkflowsForEvent } from '../event-trigger'

const order: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  interruptWaitingRuns.mockImplementation(async () => {
    order.push('interrupt')
  })
  dispatchWorkflowTrigger.mockImplementation(async () => {
    order.push('dispatch')
  })
  findWaitingCustomerFacingRun.mockResolvedValue(null)
  readMessageBlockReply.mockResolvedValue(null)

  mockTicketConversationRow.current = null
  mockDbSelect.mockImplementation(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () =>
        mockTicketConversationRow.current ? [mockTicketConversationRow.current] : [],
    }
    return chain
  })
})

const base = { id: 'evt', timestamp: '2026-01-05T10:00:00Z', actor: { type: 'user' as const } }

describe('dispatchWorkflowsForEvent', () => {
  it('interrupts pending waits before dispatching on a message (reply)', async () => {
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'message.created',
      data: { message: { conversationId: 'conversation_1', senderType: 'visitor', content: 'hi' } },
    } as unknown as EventData)
    // A visitor message never interrupts a parked assistant-wait (Phase C,
    // slice C-6) — see the dedicated describe block below.
    expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
      excludeWaitKind: 'assistant',
    })
    expect(order).toEqual(['interrupt', 'dispatch']) // interrupt strictly first
  })

  it('does NOT interrupt on a service-authored message (Quinn/a block send) — only a human reply counts', async () => {
    // Phase C, slice C-1 regression: without this, a workflow's own
    // send_block action would self-interrupt the run that just parked,
    // since appendAssistantReply fires this same message.created event for
    // the block message it just posted.
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'message.created',
      actor: { type: 'service' as const, principalId: 'principal_quinn' },
      data: {
        message: {
          id: 'conversation_message_block1',
          conversationId: 'conversation_1',
          senderType: 'agent',
          content: 'Pick one',
        },
      },
    } as unknown as EventData)
    expect(interruptWaitingRuns).not.toHaveBeenCalled()
    expect(order).toEqual(['dispatch'])
  })

  it('interrupts on a close (no parked assistant-wait to resume instead)', async () => {
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'conversation.status_changed',
      data: { conversation: { id: 'conversation_2' }, newStatus: 'closed' },
    } as unknown as EventData)
    expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_2', {
      excludeWaitKind: undefined,
    })
    expect(order).toEqual(['interrupt', 'dispatch'])
  })

  it('does NOT interrupt on a non-close status change or other events', async () => {
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'conversation.status_changed',
      data: { conversation: { id: 'conversation_3' }, newStatus: 'snoozed' },
    } as unknown as EventData)
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'conversation.assigned',
      data: { conversation: { id: 'conversation_3' } },
    } as unknown as EventData)
    expect(interruptWaitingRuns).not.toHaveBeenCalled()
    expect(dispatchWorkflowTrigger).toHaveBeenCalledTimes(2)
  })

  it('dispatches assistant.handed_off (service-authored) without interrupting waits', async () => {
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'assistant.handed_off',
      actor: { type: 'service' as const, principalId: 'principal_assistant' },
      data: { conversationId: 'conversation_4', reason: 'frustration' },
    } as unknown as EventData)
    expect(interruptWaitingRuns).not.toHaveBeenCalled()
    expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'assistant.handed_off',
        conversationId: 'conversation_4',
        actorType: 'service',
        allowServiceActor: true,
      })
    )
  })

  it('dispatches conversation.attribute_changed (service-actored AI write) without interrupting waits, subject null for the frequency cap', async () => {
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'conversation.attribute_changed',
      actor: { type: 'service' as const, principalId: 'principal_assistant' },
      data: { conversationId: 'conversation_5', key: 'plan', value: 'pro', source: 'ai' },
    } as unknown as EventData)
    expect(interruptWaitingRuns).not.toHaveBeenCalled()
    expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'conversation.attribute_changed',
        conversationId: 'conversation_5',
        actorType: 'service',
        allowServiceActor: true,
        subjectPrincipalId: null,
      })
    )
  })

  it('does nothing for a non-conversation event (no trigger, no interrupt)', async () => {
    await dispatchWorkflowsForEvent({
      ...base,
      type: 'post.created',
      data: {},
    } as unknown as EventData)
    expect(interruptWaitingRuns).not.toHaveBeenCalled()
    expect(dispatchWorkflowTrigger).not.toHaveBeenCalled()
  })

  it('propagates a dispatch failure instead of swallowing it, so the workflow-dispatch queue job can retry', async () => {
    dispatchWorkflowTrigger.mockRejectedValueOnce(new Error('transient db error'))
    await expect(
      dispatchWorkflowsForEvent({
        ...base,
        type: 'conversation.assigned',
        data: { conversation: { id: 'conversation_6' } },
      } as unknown as EventData)
    ).rejects.toThrow('transient db error')
  })

  it('propagates an interrupt failure the same way', async () => {
    interruptWaitingRuns.mockRejectedValueOnce(new Error('lock timeout'))
    await expect(
      dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: { conversationId: 'conversation_7', senderType: 'visitor', content: 'hi' },
        },
      } as unknown as EventData)
    ).rejects.toThrow('lock timeout')
    expect(dispatchWorkflowTrigger).not.toHaveBeenCalled() // never reached — interrupt threw first
  })

  // Phase C conversational block layer (slice C-1): resume-vs-interrupt.
  describe('resume-vs-interrupt on a visitor message matching a parked input wait', () => {
    const waitingRun = {
      id: 'workflow_run_1',
      cursor: { waitKind: 'input', blockMessageId: 'conversation_message_block1' },
    }

    it('resumes the run AND still interrupts every other waiting run (e.g. a sibling background idle-close timer), excluding only the resumed run', async () => {
      // SF2(b): a matched structured reply is genuine customer activity, same
      // as any other reply — it must not leave OTHER waiting runs (which
      // never touch findWaitingCustomerFacingRun, since that's scoped to the
      // one exclusive customer-facing slot) stranded. Before this fix,
      // interruptWaitingRuns was skipped entirely on this path.
      findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
      readMessageBlockReply.mockResolvedValue({
        kind: 'buttons',
        inReplyToMessageId: 'conversation_message_block1',
        buttonKey: 'yes',
      })
      resumeWorkflowRun.mockResolvedValue({ id: 'workflow_run_1', state: 'done' })

      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'Yes',
          },
        },
      } as unknown as EventData)

      expect(findWaitingCustomerFacingRun).toHaveBeenCalledWith('conversation_1')
      expect(readMessageBlockReply).toHaveBeenCalledWith('conversation_message_reply1')
      expect(resumeWorkflowRun).toHaveBeenCalledWith('workflow_run_1', {
        blockAnswer: { kind: 'buttons', buttonKey: 'yes' },
      })
      // The resumed run itself is excluded; every OTHER waiting run (the
      // sibling timer) still interrupts.
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeRunId: 'workflow_run_1',
      })
      expect(order).toEqual(['interrupt', 'dispatch'])
      // The run resumed-and-finished (state 'done'): the hint is omitted (not
      // "still active"), so dispatchWorkflowTrigger's own probe evaluates
      // normally for any same-event customer-facing workflow instead of
      // trusting a stale "active" signal.
      expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation_1' })
      )
    })

    it('passes activeCustomerFacingRunHint: true only when the resumed run is still running/waiting post-resume', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
      readMessageBlockReply.mockResolvedValue({
        kind: 'buttons',
        inReplyToMessageId: 'conversation_message_block1',
        buttonKey: 'yes',
      })
      resumeWorkflowRun.mockResolvedValue({ id: 'workflow_run_1', state: 'waiting' })

      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'Yes',
          },
        },
      } as unknown as EventData)

      expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation_1' }),
        { activeCustomerFacingRunHint: true }
      )
    })

    it('omits the hint (does not crash) when the resume attempt no-ops (claimed/settled by something else concurrently)', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
      readMessageBlockReply.mockResolvedValue({
        kind: 'buttons',
        inReplyToMessageId: 'conversation_message_block1',
        buttonKey: 'yes',
      })
      resumeWorkflowRun.mockResolvedValue(null)

      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'Yes',
          },
        },
      } as unknown as EventData)

      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeRunId: 'workflow_run_1',
      })
      expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation_1' })
      )
    })

    it('maps each blockReply kind to its BlockAnswer shape', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
      const cases: Array<[unknown, unknown]> = [
        [
          { kind: 'collect', inReplyToMessageId: 'conversation_message_block1', value: 'a@b.com' },
          { kind: 'collect', value: 'a@b.com' },
        ],
        [
          {
            kind: 'collectReply',
            inReplyToMessageId: 'conversation_message_block1',
            value: 'thanks',
          },
          { kind: 'collectReply', value: 'thanks' },
        ],
        [
          {
            kind: 'csat',
            inReplyToMessageId: 'conversation_message_block1',
            rating: 4,
            comment: 'ok',
          },
          { kind: 'csat', rating: 4, comment: 'ok' },
        ],
      ]
      for (const [blockReply, expectedAnswer] of cases) {
        vi.clearAllMocks()
        findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
        readMessageBlockReply.mockResolvedValue(blockReply)
        await dispatchWorkflowsForEvent({
          ...base,
          type: 'message.created',
          data: {
            message: {
              id: 'conversation_message_reply1',
              conversationId: 'conversation_1',
              senderType: 'visitor',
              content: 'x',
            },
          },
        } as unknown as EventData)
        expect(resumeWorkflowRun).toHaveBeenCalledWith('workflow_run_1', {
          blockAnswer: expectedAnswer,
        })
      }
    })

    it('falls through to interrupt when no customer-facing run is waiting', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(null)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'hi',
          },
        },
      } as unknown as EventData)
      expect(readMessageBlockReply).not.toHaveBeenCalled() // narrow PK read never reached
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: 'assistant',
      })
    })

    it('falls through to interrupt when the waiting run is parked at a TIMER wait, not an input wait', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue({
        id: 'workflow_run_1',
        cursor: { waitKind: 'timer' },
      })
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'hi',
          },
        },
      } as unknown as EventData)
      expect(readMessageBlockReply).not.toHaveBeenCalled()
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: 'assistant',
      })
    })

    it('falls through to interrupt on free-typed text (no blockReply at all)', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
      readMessageBlockReply.mockResolvedValue(null)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'just typing, not tapping a button',
          },
        },
      } as unknown as EventData)
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: 'assistant',
      })
    })

    it('falls through to interrupt on a stale/mismatched reply (a different, older block message)', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(waitingRun)
      readMessageBlockReply.mockResolvedValue({
        kind: 'buttons',
        inReplyToMessageId: 'conversation_message_SOME_OTHER_block',
        buttonKey: 'yes',
      })
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'Yes',
          },
        },
      } as unknown as EventData)
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: 'assistant',
      })
    })

    it('never even looks for a waiting run on a teammate/agent message: a human takeover always interrupts, including a parked assistant-wait', async () => {
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'agent',
            content: 'I can take it from here',
          },
        },
      } as unknown as EventData)
      expect(findWaitingCustomerFacingRun).not.toHaveBeenCalled()
      // No excludeWaitKind: a teammate message interrupts everything, unlike
      // a visitor message (see the tests above).
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: undefined,
      })
    })
  })

  // Phase C conversational block layer (slice C-6): the let_assistant_answer
  // park/resume matrix — assistant.handed_off resumes down the escalated
  // edge, a close resumes down the default edge INSTEAD of interrupting that
  // run (but still interrupts every other waiting run on the conversation), a
  // visitor message never interrupts a parked assistant-wait, and a teammate
  // message does.
  describe('assistant-wait resume (let_assistant_answer)', () => {
    const assistantWaitingRun = { id: 'workflow_run_assistant', cursor: { waitKind: 'assistant' } }

    it('assistant.handed_off resumes the parked assistant-wait down the escalated edge, without interrupting', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(assistantWaitingRun)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'assistant.handed_off',
        actor: { type: 'service' as const, principalId: 'principal_assistant' },
        data: { conversationId: 'conversation_1', reason: 'frustration' },
      } as unknown as EventData)

      expect(findWaitingCustomerFacingRun).toHaveBeenCalledWith('conversation_1')
      expect(resumeWorkflowRun).toHaveBeenCalledWith('workflow_run_assistant', {
        assistantOutcome: 'escalated',
      })
      expect(interruptWaitingRuns).not.toHaveBeenCalled()
      expect(order).toEqual(['dispatch']) // the assistant.handed_off trigger itself still dispatches
    })

    it('a close resumes the parked assistant-wait down the default edge INSTEAD of interrupting it, but still interrupts every other waiting run', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(assistantWaitingRun)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'conversation.status_changed',
        data: { conversation: { id: 'conversation_1' }, newStatus: 'closed' },
      } as unknown as EventData)

      expect(resumeWorkflowRun).toHaveBeenCalledWith('workflow_run_assistant', {
        assistantOutcome: 'resolved',
      })
      // The resumed run itself is excluded; every OTHER waiting run on the
      // conversation still interrupts on close exactly as before.
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeRunId: 'workflow_run_assistant',
      })
      expect(order).toEqual(['interrupt', 'dispatch'])
    })

    it('a close with NO parked assistant-wait falls through to the ordinary blunt interrupt', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(null)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'conversation.status_changed',
        data: { conversation: { id: 'conversation_1' }, newStatus: 'closed' },
      } as unknown as EventData)
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: undefined,
      })
    })

    it('a close where the parked run is an INPUT wait (not assistant): no assistantOutcome resume, ordinary interrupt', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue({
        id: 'workflow_run_input',
        cursor: { waitKind: 'input', blockMessageId: 'conversation_message_block1' },
      })
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'conversation.status_changed',
        data: { conversation: { id: 'conversation_1' }, newStatus: 'closed' },
      } as unknown as EventData)
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: undefined,
      })
    })

    it('a visitor message never interrupts a parked assistant-wait: multi-turn Quinn conversations are normal', async () => {
      // No input-wait match (waitKind is 'assistant', not 'input'), so
      // tryResumeInputWait falls through — but the interrupt call itself must
      // still spare the assistant-wait row.
      findWaitingCustomerFacingRun.mockResolvedValue(assistantWaitingRun)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'visitor',
            content: 'actually, one more question',
          },
        },
      } as unknown as EventData)
      expect(resumeWorkflowRun).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: 'assistant',
      })
    })

    it('a teammate message DOES interrupt a parked assistant-wait: a human taking over ends the assistant turn', async () => {
      findWaitingCustomerFacingRun.mockResolvedValue(assistantWaitingRun)
      await dispatchWorkflowsForEvent({
        ...base,
        type: 'message.created',
        data: {
          message: {
            id: 'conversation_message_reply1',
            conversationId: 'conversation_1',
            senderType: 'agent',
            content: "I'll take it from here",
          },
        },
      } as unknown as EventData)
      expect(interruptWaitingRuns).toHaveBeenCalledWith('conversation_1', {
        excludeWaitKind: undefined,
      })
    })
  })

  // Ticket triggers (ticket.created / ticket.status_changed): conversation-
  // linked tickets only — the async pre-resolution (ticket_conversations
  // join) runs BEFORE eventToWorkflowTrigger builds the real trigger, and
  // dispatches straight through (no interrupt/resume machinery), mirroring
  // the unresponsive pair's own early-return branch above.
  describe('ticket triggers', () => {
    const ticketEvent = (
      type: 'ticket.created' | 'ticket.status_changed',
      extra: Record<string, unknown> = {}
    ): EventData =>
      ({
        ...base,
        type,
        data: {
          ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
          ...(type === 'ticket.status_changed'
            ? { previousStatus: 'open', newStatus: 'closed', stage: 'new' }
            : {
                ticket: {
                  id: 'ticket_1',
                  number: 1,
                  type: 'customer',
                  priority: 'none',
                  title: 'A ticket',
                  status: 'open',
                  stage: 'new',
                  requesterPrincipalId: null,
                  companyId: null,
                  createdAt: '2026-01-05T09:00:00Z',
                  updatedAt: '2026-01-05T09:00:00Z',
                  resolvedAt: null,
                },
              }),
          ...extra,
        },
      }) as unknown as EventData

    it('dispatches straight through (no interrupt) when the ticket has a linked customer conversation', async () => {
      mockTicketConversationRow.current = { conversationId: 'conversation_linked' }
      await dispatchWorkflowsForEvent(ticketEvent('ticket.created'))
      expect(interruptWaitingRuns).not.toHaveBeenCalled()
      expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerType: 'ticket.created',
          conversationId: 'conversation_linked',
        })
      )
    })

    it('does not dispatch at all when the ticket has no linked conversation', async () => {
      mockTicketConversationRow.current = null
      await dispatchWorkflowsForEvent(ticketEvent('ticket.created'))
      expect(dispatchWorkflowTrigger).not.toHaveBeenCalled()
      expect(interruptWaitingRuns).not.toHaveBeenCalled()
    })

    it('resolves ticket.status_changed the same way, carrying the entered category', async () => {
      mockTicketConversationRow.current = { conversationId: 'conversation_linked' }
      await dispatchWorkflowsForEvent(ticketEvent('ticket.status_changed'))
      expect(dispatchWorkflowTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerType: 'ticket.status_changed',
          conversationId: 'conversation_linked',
          ticketStatusCategory: 'closed',
        })
      )
    })

    it('ticket.status_changed with no linked conversation does not dispatch', async () => {
      mockTicketConversationRow.current = null
      await dispatchWorkflowsForEvent(ticketEvent('ticket.status_changed'))
      expect(dispatchWorkflowTrigger).not.toHaveBeenCalled()
    })
  })
})
