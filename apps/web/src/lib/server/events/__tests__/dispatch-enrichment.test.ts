/**
 * Phase 3 enrichment: verifies `buildTicketRef` joins related tables and
 * embeds snapshot fields + a deep-link URL on dispatched ticket events.
 *
 * Exercised through a public dispatcher (`dispatchTicketCreated`) so we cover
 * the real call path; the dispatched event is captured by mocking
 * `./process` (the indirect target of `dispatchEvent`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ticketStatusFindFirstMock = vi.fn()
const inboxFindFirstMock = vi.fn()
const teamFindFirstMock = vi.fn()
const contactFindFirstMock = vi.fn()
const organizationFindFirstMock = vi.fn()

const processEventMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketStatuses: { findFirst: ticketStatusFindFirstMock },
      inboxes: { findFirst: inboxFindFirstMock },
      teams: { findFirst: teamFindFirstMock },
      contacts: { findFirst: contactFindFirstMock },
      organizations: { findFirst: organizationFindFirstMock },
    },
  },
  eq: vi.fn(),
  ticketStatuses: { _name: 'ticket_statuses' },
  inboxes: { _name: 'inboxes' },
  teams: { _name: 'teams' },
  contacts: { _name: 'contacts' },
  organizations: { _name: 'organizations' },
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => 'https://example.test',
}))

vi.mock('../process', () => ({
  processEvent: (...a: unknown[]) => processEventMock(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  ticketStatusFindFirstMock.mockReset()
  inboxFindFirstMock.mockReset()
  teamFindFirstMock.mockReset()
  contactFindFirstMock.mockReset()
  organizationFindFirstMock.mockReset()
  processEventMock.mockReset()
})

const baseActor = { type: 'service' as const, displayName: 'test' }

interface DispatchedEvent {
  type: string
  data: { ticket: Record<string, unknown> }
}

function lastDispatchedEvent(): DispatchedEvent {
  expect(processEventMock).toHaveBeenCalledTimes(1)
  return processEventMock.mock.calls[0][0] as DispatchedEvent
}

describe('buildTicketRef enrichment via dispatchTicketCreated', () => {
  it('snapshots status / inbox / team / contact / organization names plus ticketUrl', async () => {
    ticketStatusFindFirstMock.mockResolvedValueOnce({ name: 'Open' })
    inboxFindFirstMock.mockResolvedValueOnce({ name: 'Support', slug: 'support' })
    teamFindFirstMock.mockResolvedValueOnce({ name: 'CX Team' })
    contactFindFirstMock.mockResolvedValueOnce({
      name: 'Ada Lovelace',
      email: '[email protected]',
      organizationId: 'org_1',
    })
    organizationFindFirstMock.mockResolvedValueOnce({ name: 'Acme', domain: 'acme.com' })

    const { dispatchTicketCreated } = await import('../dispatch')
    await dispatchTicketCreated(baseActor, {
      id: 'ticket_1',
      subject: 'help',
      statusId: 'ticket_status_open',
      statusCategory: 'open',
      priority: 'normal',
      channel: 'portal',
      visibilityScope: 'team',
      inboxId: 'inbox_1',
      primaryTeamId: 'team_1',
      assigneePrincipalId: null,
      assigneeTeamId: null,
      requesterPrincipalId: null,
      requesterContactId: 'contact_1',
      organizationId: null,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      firstResponseAt: null,
      resolvedAt: null,
      reopenedAt: null,
      closedAt: null,
    })

    const event = lastDispatchedEvent()
    expect(event.type).toBe('ticket.created')
    const ticket = event.data.ticket
    expect(ticket.id).toBe('ticket_1')
    expect(ticket.statusName).toBe('Open')
    expect(ticket.inboxName).toBe('Support')
    expect(ticket.inboxSlug).toBe('support')
    expect(ticket.primaryTeamName).toBe('CX Team')
    expect(ticket.requesterEmail).toBe('[email protected]')
    expect(ticket.requesterName).toBe('Ada Lovelace')
    expect(ticket.organizationName).toBe('Acme')
    expect(ticket.organizationDomain).toBe('acme.com')
    expect(ticket.createdAt).toBe('2026-05-01T10:00:00.000Z')
    expect(ticket.ticketUrl).toBe('https://example.test/admin/tickets/ticket_1')
  })

  it('skips lookups for null IDs and leaves snapshot fields null', async () => {
    const { dispatchTicketCreated } = await import('../dispatch')
    await dispatchTicketCreated(baseActor, {
      id: 'ticket_2',
      subject: null,
      statusId: null,
      statusCategory: null,
      priority: null,
      channel: null,
      visibilityScope: null,
      inboxId: null,
      primaryTeamId: null,
      assigneePrincipalId: null,
      assigneeTeamId: null,
      requesterPrincipalId: null,
      requesterContactId: null,
      organizationId: null,
    })

    expect(ticketStatusFindFirstMock).not.toHaveBeenCalled()
    expect(inboxFindFirstMock).not.toHaveBeenCalled()
    expect(teamFindFirstMock).not.toHaveBeenCalled()
    expect(contactFindFirstMock).not.toHaveBeenCalled()
    expect(organizationFindFirstMock).not.toHaveBeenCalled()

    const ticket = lastDispatchedEvent().data.ticket
    expect(ticket.statusName).toBeNull()
    expect(ticket.inboxName).toBeNull()
    expect(ticket.requesterEmail).toBeNull()
    expect(ticket.organizationName).toBeNull()
    expect(ticket.ticketUrl).toBe('https://example.test/admin/tickets/ticket_2')
  })

  it('falls back to the bare ref when an enrichment query throws', async () => {
    ticketStatusFindFirstMock.mockRejectedValueOnce(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { dispatchTicketCreated } = await import('../dispatch')
    await dispatchTicketCreated(baseActor, {
      id: 'ticket_3',
      subject: 'x',
      statusId: 'ticket_status_open',
      statusCategory: 'open',
      priority: 'normal',
      channel: 'portal',
      visibilityScope: 'team',
      inboxId: null,
      primaryTeamId: null,
      assigneePrincipalId: null,
      assigneeTeamId: null,
      requesterPrincipalId: null,
      requesterContactId: null,
      organizationId: null,
    })

    const ticket = lastDispatchedEvent().data.ticket
    expect(ticket.id).toBe('ticket_3')
    expect(ticket.statusName).toBeUndefined()
    expect(ticket.ticketUrl).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('reuses primary team name for the assignee team when both IDs match', async () => {
    teamFindFirstMock.mockResolvedValueOnce({ name: 'Shared Team' })
    const { dispatchTicketCreated } = await import('../dispatch')
    await dispatchTicketCreated(baseActor, {
      id: 'ticket_4',
      subject: 'x',
      statusId: null,
      statusCategory: null,
      priority: null,
      channel: null,
      visibilityScope: null,
      inboxId: null,
      primaryTeamId: 'team_1',
      assigneePrincipalId: null,
      assigneeTeamId: 'team_1',
      requesterPrincipalId: null,
      requesterContactId: null,
      organizationId: null,
    })
    expect(teamFindFirstMock).toHaveBeenCalledTimes(1)
    const ticket = lastDispatchedEvent().data.ticket
    expect(ticket.primaryTeamName).toBe('Shared Team')
    expect(ticket.assigneeTeamName).toBe('Shared Team')
  })
})
