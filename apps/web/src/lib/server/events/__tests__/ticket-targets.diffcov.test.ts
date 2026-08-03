/**
 * Differential-coverage tests for ticket-targets — exhaustive coverage of the
 * pure `buildTicketEmailEventConfig` event-type switch and the formatting
 * helpers (humanize, byte/date formatting, diff rendering, thread-body
 * truncation) it routes through.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/db', () => ({
  db: {},
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  ticketShares: {},
  teamMemberships: {},
  principal: {},
  user: {},
}))
// buildTicketEmailEventConfig is pure; stub the domain collaborators so their
// real (db-touching) module bodies never load.
vi.mock('../../domains/tickets/ticket.subscriptions', () => ({ getSubscribers: vi.fn() }))
vi.mock('../../domains/tickets/ticket.recipients', () => ({
  resolvePortalLinkedRecipients: vi.fn(),
  resolvePrincipalsForContacts: vi.fn(),
}))
vi.mock('../../domains/tickets/ticket.permissions', () => ({
  canViewTicket: vi.fn(),
  toResourceScope: vi.fn(),
}))
vi.mock('../../domains/authz/authz.service', () => ({ loadPermissionSet: vi.fn() }))
vi.mock('../../domains/subscriptions/subscription.service', () => ({
  batchGenerateUnsubscribeTokens: vi.fn(),
  batchGetNotificationPreferences: vi.fn(),
}))

import { buildTicketEmailEventConfig } from '../ticket-targets'

const baseTicket = {
  id: 'ticket_1',
  priority: 'high',
  inboxName: 'Support',
  primaryTeamName: 'Team A',
  channel: 'email',
  visibility: 'internal',
  requesterName: 'Jane',
  requesterEmail: 'jane@x.test',
  descriptionText: 'Body text',
  createdAt: '2026-01-01T00:00:00Z',
}

function ev(type: string, data: Record<string, unknown> = {}) {
  return {
    type,
    data: { ticket: { ...baseTicket }, ...data },
    actor: { displayName: 'Actor', email: 'actor@x.test', principalId: 'p1' },
    timestamp: '2026-02-02T10:00:00Z',
  } as never
}

const build = (
  type: string,
  data?: Record<string, unknown>,
  subject: string | null = 'My subject',
  status: string | null = 'open'
) => buildTicketEmailEventConfig(ev(type, data), 'https://app.test', subject, status)

describe('buildTicketEmailEventConfig event types', () => {
  it('covers created (with description + createdAt)', () => {
    const c = build('ticket.created')
    expect(c.eventLabel).toBe('Ticket opened')
    expect(c.ticketUrl).toBe('https://app.test/tickets/ticket_1')
  })

  it('covers assigned (with and without previous/new assignee)', () => {
    expect(
      build('ticket.assigned', { previousAssigneePrincipalId: 'p0', newAssigneePrincipalId: 'p9' })
        .eventLabel
    ).toBe('Assignment changed')
    const t = ev('ticket.assigned')
    ;(t as never as { data: { ticket: Record<string, unknown> } }).data.ticket.assigneeTeamName =
      'Team Z'
    expect(buildTicketEmailEventConfig(t, 'https://app.test', 's', 'open').eventLabel).toBe(
      'Assignment changed'
    )
  })

  it('covers unassigned', () => {
    expect(build('ticket.unassigned', { previousAssigneePrincipalId: 'p0' }).eventLabel).toBe(
      'Ticket unassigned'
    )
  })

  it('covers status_changed', () => {
    expect(
      build('ticket.status_changed', {
        previousStatusCategory: 'open',
        newStatusCategory: 'solved',
      }).eventLabel
    ).toBe('Status changed')
  })

  it('covers updated with many, one, and zero changed fields', () => {
    const many = build('ticket.updated', {
      changedFields: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      diff: { a: { from: 'x', to: 'y' } },
    })
    expect(many.eventLabel).toBe('Ticket details changed')
    expect(
      build('ticket.updated', {
        changedFields: ['priority'],
        diff: { priority: { from: 'low', to: 'high' } },
      }).eventLabel
    ).toBe('Ticket details changed')
    expect(build('ticket.updated', {}).eventLabel).toBe('Ticket details changed')
  })

  it('covers thread added (requester + non-requester)', () => {
    expect(
      build('ticket.thread_added', {
        thread: { isFromRequester: true, createdAt: '2026-01-02T00:00:00Z', bodyText: 'hi' },
        audience: 'public',
      }).eventLabel
    ).toBe('New reply')
    expect(build('ticket.thread_added', { thread: null }).eventLabel).toBe('New reply')
  })

  it('covers thread updated and deleted', () => {
    expect(
      build('ticket.thread_updated', {
        thread: { editedAt: '2026-01-02T00:00:00Z', bodyTextPreview: 'p', bodyTextTruncated: true },
        audience: 'internal',
      }).eventLabel
    ).toBe('Reply updated')
    expect(build('ticket.thread_deleted', { thread: { bodyText: 'x' } }).eventLabel).toBe(
      'Reply removed'
    )
  })

  it('covers participant added/removed', () => {
    expect(build('ticket.participant_added', { role: 'collaborator' }).eventLabel).toBe(
      'Participant added'
    )
    expect(build('ticket.participant_removed').eventLabel).toBe('Participant removed')
  })

  it('covers shared/unshared', () => {
    expect(build('ticket.shared', { accessLevel: 'read' }).eventLabel).toBe('Ticket shared')
    expect(build('ticket.unshared').eventLabel).toBe('Ticket access revoked')
  })

  it('covers sla warning/breach and first_response', () => {
    expect(
      build('ticket.sla_warning', { ruleName: 'Rule', kind: 'first_response' }).eventLabel
    ).toBe('SLA warning')
    expect(build('ticket.sla_breach', { kind: 'resolution' }).eventLabel).toBe('SLA breached')
    expect(
      build('ticket.first_response', { firstResponseAt: '2026-01-02T00:00:00Z' }).eventLabel
    ).toBe('First response recorded')
  })

  it('covers attachment added (with and without publicUrl) and removed', () => {
    expect(
      build('ticket.attachment_added', {
        attachment: {
          filename: 'f.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          threadId: 't1',
          publicUrl: 'https://x/f',
        },
      }).eventLabel
    ).toBe('Attachment added')
    expect(
      build('ticket.attachment_added', {
        attachment: { filename: 'f.png', mimeType: 'image/png', sizeBytes: 5, threadId: 't1' },
      }).eventLabel
    ).toBe('Attachment added')
    expect(
      build('ticket.attachment_removed', { attachment: { filename: 'f.png', threadId: 't1' } })
        .eventLabel
    ).toBe('Attachment removed')
  })

  it('covers deleted/restored and the default (unknown) event', () => {
    expect(build('ticket.deleted').eventLabel).toBe('Ticket deleted')
    expect(build('ticket.restored').eventLabel).toBe('Ticket restored')
    expect(build('ticket.unknown_event').eventLabel).toBe('Ticket updated')
  })

  it('handles a null subject and null status label', () => {
    const c = build('ticket.created', {}, null, null)
    expect(c.ticketSubject).toBe('ticket')
    expect(c.statusLabel).toBeUndefined()
  })

  it('falls back to actor email when displayName is missing', () => {
    const e = ev('ticket.created')
    ;(e as never as { actor: { displayName: string | null } }).actor.displayName = null
    expect(buildTicketEmailEventConfig(e, 'https://app.test', 's', 'open').actorName).toBe(
      'actor@x.test'
    )
  })

  it('handles a ticket with no requester name/email and an invalid timestamp', () => {
    const e = ev('ticket.created', {
      ticket: { id: 'ticket_2', descriptionText: null, priority: null },
    })
    ;(e as never as { timestamp: string }).timestamp = 'not-a-date'
    const c = buildTicketEmailEventConfig(e, 'https://app.test', 's', null)
    expect(c.occurredAt).toBe('not-a-date')
  })
})
