/**
 * Unit coverage for the event -> workflow-trigger mapping (§4.6, Slice 5d-iii):
 * conversation/message events map with the right conversationId / actor / subject
 * / message; non-conversation events map to null; and the service actor is carried
 * through for the dispatcher to gate.
 */
import { describe, it, expect } from 'vitest'
import type { EventData } from '@/lib/server/events/types'
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
      message: { body: 'I need help' },
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

  it('returns null for non-conversation events', () => {
    for (const type of [
      'post.created',
      'comment.created',
      'ticket.created',
      'changelog.published',
    ]) {
      const event = { ...base, type, actor: userActor, data: {} } as unknown as EventData
      expect(eventToWorkflowTrigger(event)).toBeNull()
    }
  })
})
