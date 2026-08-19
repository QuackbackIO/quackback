/**
 * Unit coverage for the event -> workflow-trigger mapping (§4.6, Slice 5d-iii):
 * conversation/message events map with the right conversationId / actor / subject
 * / message; non-conversation events map to null; and the service actor is carried
 * through for the dispatcher to gate.
 */
import { describe, it, expect } from 'vitest'
import type { EventData } from '@/lib/server/events/types'
import {
  DISPATCHABLE_TRIGGER_TYPES,
  type DispatchableTriggerType,
} from '@/lib/shared/workflow-trigger-types'
import { eventToWorkflowTrigger } from '../event-trigger'

const userActor = { type: 'user' as const, principalId: 'principal_agent' }
const serviceActor = { type: 'service' as const, service: 'automation' }
const base = { id: 'evt_1', timestamp: '2026-01-05T10:00:00Z' }

describe('eventToWorkflowTrigger', () => {
  it('maps conversation.created with the visitor as the cap subject', () => {
    const event = {
      ...base,
      type: 'conversation.created',
      actor: userActor,
      data: { conversation: { id: 'conversation_1', visitorPrincipalId: 'principal_visitor' } },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toEqual({
      triggerType: 'conversation.created',
      conversationId: 'conversation_1',
      actorType: 'user',
      subjectPrincipalId: 'principal_visitor',
      message: null,
    })
  })

  it('maps a visitor message with its body and the visitor subject', () => {
    const event = {
      ...base,
      type: 'message.created',
      actor: userActor,
      data: {
        message: {
          id: 'm1',
          conversationId: 'conversation_9',
          senderType: 'visitor',
          authorPrincipalId: 'principal_visitor',
          content: 'I need help',
        },
        conversation: { id: 'conversation_9' },
      },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toEqual({
      triggerType: 'message.created',
      conversationId: 'conversation_9',
      actorType: 'user',
      subjectPrincipalId: 'principal_visitor',
      message: { body: 'I need help', senderType: 'visitor' },
    })
  })

  it('maps a teammate message with no cap subject', () => {
    const event = {
      ...base,
      type: 'message.created',
      actor: userActor,
      data: {
        message: {
          id: 'm2',
          conversationId: 'conversation_9',
          senderType: 'agent',
          authorPrincipalId: 'principal_agent',
          content: 'On it',
        },
        conversation: { id: 'conversation_9' },
      },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toMatchObject({
      triggerType: 'message.created',
      subjectPrincipalId: null,
      message: { body: 'On it' },
    })
  })

  it('maps agent-driven conversation events (no subject, no message)', () => {
    const event = {
      ...base,
      type: 'conversation.status_changed',
      actor: userActor,
      data: {
        conversation: { id: 'conversation_3' },
        previousStatus: 'open',
        newStatus: 'snoozed',
      },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toMatchObject({
      triggerType: 'conversation.status_changed',
      conversationId: 'conversation_3',
      subjectPrincipalId: null,
      message: null,
    })
  })

  it('carries a service actor through (the dispatcher gates it)', () => {
    const event = {
      ...base,
      type: 'conversation.created',
      actor: serviceActor,
      data: { conversation: { id: 'conversation_1', visitorPrincipalId: 'principal_visitor' } },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)?.actorType).toBe('service')
  })

  it('does NOT opt a service-authored message.note_created out of the automated-actor gate (loop guard: a workflow add_note action must not re-trigger note-triggered workflows)', () => {
    // A workflow's add_note action (action.executor.ts) posts through
    // addAgentNote as the assistant's service principal, so the
    // message.note_created event it fires carries a service actor exactly
    // like this one. Unlike assistant.handed_off (a terminal, one-time
    // signal no workflow action can itself produce), a note IS something a
    // workflow action produces, so this mapping must stay truthful
    // (actorType: 'service') with no allowServiceActor — the dispatcher's
    // human-actor gate is what actually blocks the retrigger (see
    // dispatcher.test.ts's matching regression test).
    const event = {
      ...base,
      type: 'message.note_created',
      actor: { type: 'service' as const, principalId: 'principal_quinn' },
      data: {
        message: {
          id: 'm_note1',
          conversationId: 'conversation_1',
          senderType: 'agent',
          authorPrincipalId: 'principal_quinn',
          content: 'Escalated to VIP',
        },
        conversation: { id: 'conversation_1' },
      },
    } as unknown as EventData
    const trigger = eventToWorkflowTrigger(event)
    expect(trigger).toMatchObject({
      triggerType: 'message.note_created',
      actorType: 'service',
    })
    expect(trigger?.allowServiceActor).toBeFalsy()
  })

  it('maps assistant.handed_off truthfully as service-authored, opted out of the automated-actor gate', () => {
    const event = {
      ...base,
      type: 'assistant.handed_off',
      actor: { type: 'service' as const, principalId: 'principal_assistant' },
      data: { conversationId: 'conversation_5', reason: 'low_confidence' },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toEqual({
      triggerType: 'assistant.handed_off',
      conversationId: 'conversation_5',
      actorType: 'service',
      allowServiceActor: true,
      subjectPrincipalId: null,
      message: null,
    })
  })

  it('maps conversation.attribute_changed truthfully as service-authored when AI wrote it, opted out of the automated-actor gate, with no subject/message', () => {
    const event = {
      ...base,
      type: 'conversation.attribute_changed',
      actor: { type: 'service' as const, principalId: 'principal_assistant' },
      data: { conversationId: 'conversation_5', key: 'plan', value: 'pro', source: 'ai' },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toEqual({
      triggerType: 'conversation.attribute_changed',
      conversationId: 'conversation_5',
      actorType: 'service',
      allowServiceActor: true,
      subjectPrincipalId: null,
      message: null,
    })
  })

  it('maps conversation.attribute_changed for a teammate write as a plain user actor (still allowServiceActor: true, unused here)', () => {
    const event = {
      ...base,
      type: 'conversation.attribute_changed',
      actor: userActor,
      data: { conversationId: 'conversation_5', key: 'plan', value: 'pro', source: 'teammate' },
    } as unknown as EventData
    expect(eventToWorkflowTrigger(event)).toMatchObject({
      triggerType: 'conversation.attribute_changed',
      conversationId: 'conversation_5',
      actorType: 'user',
      subjectPrincipalId: null,
    })
  })

  it('returns null for non-conversation events', () => {
    for (const type of ['post.created', 'comment.created', 'changelog.published']) {
      const event = { ...base, type, actor: userActor, data: {} } as unknown as EventData
      expect(eventToWorkflowTrigger(event)).toBeNull()
    }
  })
})

/**
 * Ticket triggers (ticket.created / ticket.status_changed) are conversation-
 * linked tickets ONLY: the event payload never carries a conversationId, so
 * eventToWorkflowTrigger takes it as an explicit second argument, resolved
 * asynchronously by dispatchWorkflowsForEvent's own ticket branch (covered at
 * the dispatch level in event-trigger-dispatch.test.ts) BEFORE this mapping
 * runs. Called with no second argument at all (the coarse events/process.ts
 * pre-filter, or this file's own DISPATCHABLE_TRIGGER_TYPES sync test below)
 * must NOT read as "definitely unlinked" — only an explicit resolved `null`
 * does.
 */
describe('eventToWorkflowTrigger: ticket triggers', () => {
  const ticketCreated = (): EventData =>
    ({
      ...base,
      type: 'ticket.created',
      actor: userActor,
      data: {
        ticket: {
          id: 'ticket_1',
          number: 42,
          type: 'customer',
          priority: 'none',
          title: 'Cannot log in',
          status: 'open',
          stage: 'new',
          requesterPrincipalId: 'principal_visitor',
          companyId: null,
          createdAt: '2026-01-05T09:00:00Z',
          updatedAt: '2026-01-05T09:00:00Z',
          resolvedAt: null,
        },
      },
    }) as unknown as EventData

  const ticketStatusChanged = (previousStatus: string, newStatus: string): EventData =>
    ({
      ...base,
      type: 'ticket.status_changed',
      actor: userActor,
      data: {
        ticket: { id: 'ticket_1', number: 42, type: 'customer', priority: 'none' },
        previousStatus,
        newStatus,
        stage: 'new',
      },
    }) as unknown as EventData

  it('maps ticket.created to the resolved conversationId when given one', () => {
    const trigger = eventToWorkflowTrigger(ticketCreated(), 'conversation_9' as never)
    expect(trigger).toMatchObject({
      triggerType: 'ticket.created',
      conversationId: 'conversation_9',
      actorType: 'user',
      subjectPrincipalId: null,
      message: null,
    })
    expect(trigger?.allowServiceActor).toBeUndefined()
  })

  it('maps ticket.created to null when explicitly resolved to no linked conversation', () => {
    expect(eventToWorkflowTrigger(ticketCreated(), null)).toBeNull()
  })

  it('maps ticket.status_changed to the resolved conversationId, with the entered category when the category genuinely crosses', () => {
    const trigger = eventToWorkflowTrigger(
      ticketStatusChanged('open', 'closed'),
      'conversation_9' as never
    )
    expect(trigger).toMatchObject({
      triggerType: 'ticket.status_changed',
      conversationId: 'conversation_9',
      ticketStatusCategory: 'closed',
    })
  })

  it('resolves ticketStatusCategory to null for same-category churn (no genuine crossing)', () => {
    const trigger = eventToWorkflowTrigger(
      ticketStatusChanged('open', 'open'),
      'conversation_9' as never
    )
    expect(trigger).toMatchObject({ ticketStatusCategory: null })
  })

  it('maps ticket.status_changed to null when explicitly resolved to no linked conversation', () => {
    expect(eventToWorkflowTrigger(ticketStatusChanged('open', 'closed'), null)).toBeNull()
  })

  it('does NOT opt a service-authored ticket.status_changed out of the automated-actor gate (loop guard: a workflow set_ticket_status action must not re-trigger ticket.status_changed workflows)', () => {
    const event = {
      ...ticketStatusChanged('open', 'pending'),
      actor: serviceActor,
    } as unknown as EventData
    const trigger = eventToWorkflowTrigger(event, 'conversation_9' as never)
    expect(trigger?.actorType).toBe('service')
    expect(trigger?.allowServiceActor).toBeUndefined()
  })
})

/**
 * DISPATCHABLE_TRIGGER_TYPES (lib/shared/workflow-trigger-types.ts) is kept in
 * sync with eventToWorkflowTrigger's switch by hand comment only. The
 * dangerous direction is an array entry with no matching switch case: that
 * lets a workflow save cleanly against a triggerType (authoring validation
 * uses the same array) which then silently never fires, since the switch's
 * default falls through to null. A compile-time tie (e.g. a `satisfies
 * Record<DispatchableTriggerType, ...>` table) isn't a good fit here without
 * restructuring eventToWorkflowTrigger into a per-type lookup: the payload
 * shape genuinely differs per case (message body/subject derivation, the
 * assistant.handed_off opt-out of the automated-actor gate, ...), so a
 * uniform mapped type would just relocate the same branching into an uglier
 * shape for no real safety gain. This is the chosen route instead: a runtime
 * check that every listed type maps to a non-null trigger from a minimal
 * synthetic event of that type, so a future array entry added without a
 * switch case fails this test immediately (returns null) rather than
 * shipping a workflow trigger type that can never fire.
 */
describe('DISPATCHABLE_TRIGGER_TYPES stays in sync with the switch', () => {
  const withData = (type: string, data: unknown): EventData =>
    ({ ...base, type, actor: userActor, data }) as unknown as EventData

  // The switch here must cover every DispatchableTriggerType (TS enforces
  // this via the function's return type), so an addition to the array with
  // no case below fails typecheck, and a case with no array entry fails here
  // at runtime instead of only living in a hand-maintained comment.
  function minimalEventFor(type: DispatchableTriggerType): EventData {
    switch (type) {
      case 'conversation.created':
        return withData(type, {
          conversation: { id: 'conversation_1', visitorPrincipalId: 'principal_visitor' },
        })
      case 'conversation.status_changed':
        return withData(type, {
          conversation: { id: 'conversation_1' },
          previousStatus: 'open',
          newStatus: 'closed',
        })
      case 'conversation.assigned':
      case 'conversation.priority_changed':
      case 'conversation.csat_submitted':
        return withData(type, { conversation: { id: 'conversation_1' } })
      case 'message.created':
      case 'message.note_created':
        return withData(type, {
          message: {
            id: 'm1',
            conversationId: 'conversation_1',
            senderType: 'agent',
            authorPrincipalId: 'principal_agent',
            content: 'hi',
          },
          conversation: { id: 'conversation_1' },
        })
      case 'conversation.attribute_changed':
        return withData(type, {
          conversationId: 'conversation_1',
          key: 'plan',
          value: 'pro',
          source: 'ai',
        })
      case 'assistant.handed_off':
        return withData(type, { conversationId: 'conversation_1', reason: 'low_confidence' })
      case 'conversation.customer_unresponsive':
      case 'conversation.teammate_unresponsive':
        return withData(type, {
          conversationId: 'conversation_1',
          workflowId: 'workflow_1',
          silenceMinutes: 60,
          sinceAt: '2026-01-05T09:00:00Z',
        })
      case 'sla.approaching_breach':
      case 'sla.breached':
        return withData(type, {
          conversationId: 'conversation_1',
          clock: 'first_response',
          dueAt: '2026-01-05T11:00:00Z',
        })
      case 'ticket.created':
        return withData(type, {
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
        })
      case 'ticket.status_changed':
        return withData(type, {
          ticket: { id: 'ticket_1', number: 1, type: 'customer', priority: 'none' },
          previousStatus: 'open',
          newStatus: 'closed',
          stage: 'new',
        })
    }
  }

  it.each(DISPATCHABLE_TRIGGER_TYPES)('%s maps to a non-null trigger', (type) => {
    expect(eventToWorkflowTrigger(minimalEventFor(type))).not.toBeNull()
  })
})
