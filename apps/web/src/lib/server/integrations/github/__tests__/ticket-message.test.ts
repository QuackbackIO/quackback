/**
 * Unit tests for ticket-message.ts — outbound GitHub issue formatting.
 */
import { describe, it, expect } from 'vitest'
import { buildTicketIssueBody, buildTicketUpdateBody } from '../ticket-message'
import type { EventData, EventTicketRef } from '../../../events/types'

const baseActor = { type: 'user' as const, principalId: 'principal_agent1' }
const baseTicket: EventTicketRef = {
  id: 'ticket_01test',
  subject: 'Login button broken on mobile',
  descriptionText: 'Users report that tapping login does nothing on iOS Safari.',
  statusId: 'tstatus_open',
  statusCategory: 'open',
  priority: 'high',
  channel: 'portal',
  visibility: 'team',
  inboxId: 'inbox_01',
  primaryTeamId: 'team_01',
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: 'principal_user1',
  requesterContactId: null,
}

function ticketCreatedEvent(overrides: Partial<EventTicketRef> = {}): EventData {
  return {
    id: 'evt_test',
    timestamp: '2026-06-11T00:00:00Z',
    actor: baseActor,
    type: 'ticket.created',
    data: { ticket: { ...baseTicket, ...overrides } },
  } as EventData
}

describe('buildTicketIssueBody', () => {
  it('formats title from ticket subject', () => {
    const { title } = buildTicketIssueBody(ticketCreatedEvent())
    expect(title).toBe('Login button broken on mobile')
  })

  it('includes priority emoji label for non-normal priorities', () => {
    const { labels } = buildTicketIssueBody(ticketCreatedEvent({ priority: 'urgent' }))
    expect(labels).toContain('priority:urgent')
  })

  it('omits priority label for normal priority', () => {
    const { labels } = buildTicketIssueBody(ticketCreatedEvent({ priority: 'normal' }))
    expect(labels).not.toContain('priority:normal')
  })

  it('includes description text in body', () => {
    const { body } = buildTicketIssueBody(ticketCreatedEvent())
    expect(body).toContain('Users report that tapping login does nothing on iOS Safari.')
  })

  it('handles null description gracefully', () => {
    const { body } = buildTicketIssueBody(ticketCreatedEvent({ descriptionText: null }))
    // Should not crash; body should still contain metadata
    expect(body).toBeDefined()
    expect(body).not.toContain('null')
  })

  it('returns generic title for non-created events', () => {
    const event = {
      id: 'evt_test',
      timestamp: '2026-06-11T00:00:00Z',
      actor: baseActor,
      type: 'ticket.updated',
      data: { ticket: baseTicket, changedFields: ['subject'], diff: {} },
    } as EventData
    const { title } = buildTicketIssueBody(event)
    expect(title).toBe('Ticket')
  })
})

describe('buildTicketUpdateBody', () => {
  it('returns title from ticket subject', () => {
    const { title } = buildTicketUpdateBody(baseTicket)
    expect(title).toBe('Login button broken on mobile')
  })

  it('returns undefined title when subject is empty', () => {
    const { title } = buildTicketUpdateBody({ ...baseTicket, subject: '' })
    expect(title).toBeUndefined()
  })

  it('includes description in body', () => {
    const { body } = buildTicketUpdateBody(baseTicket)
    expect(body).toContain('Users report that tapping login')
  })
})
