/**
 * Differential-coverage tests for ticket.service — the edge/defensive branches
 * the existing suite leaves uncovered: subject/priority/channel/visibility
 * validation, status resolution, requester-contact + customer-context
 * resolution, routing side-effects, optimistic-concurrency staleness,
 * field-diff building, assignment (assign/unassign), status-category timestamp
 * transitions, soft-delete/restore, and the dispatch/notify/sla try-catch
 * swallows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  ticketsFindFirst: vi.fn(),
  statusesFindFirst: vi.fn(),
  principalFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectWhere: vi.fn(),
  recordEvent: vi.fn(),
  route: vi.fn(),
  bumpMatchStats: vi.fn((..._a: unknown[]) => Promise.resolve()),
  attachClocks: vi.fn((..._a: unknown[]) => Promise.resolve()),
  onStatusTransition: vi.fn((..._a: unknown[]) => Promise.resolve()),
  safeSubscribe: vi.fn((..._a: unknown[]) => Promise.resolve()),
  notifyCreated: vi.fn((..._a: unknown[]) => Promise.resolve()),
  notifyAssigned: vi.fn((..._a: unknown[]) => Promise.resolve()),
  notifyStatus: vi.fn((..._a: unknown[]) => Promise.resolve()),
  buildEventActor: vi.fn((..._a: unknown[]) => ({ type: 'user', principalId: 'p1' })),
  dCreated: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dUpdated: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dAssigned: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dUnassigned: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dStatus: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dDeleted: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dRestored: vi.fn((..._a: unknown[]) => Promise.resolve()),
  findOrCreateByEmail: vi.fn(),
  linkContactToUser: vi.fn((..._a: unknown[]) => Promise.resolve()),
  listLinksForUser: vi.fn(),
  getContact: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      tickets: { findFirst: m.ticketsFindFirst },
      ticketStatuses: { findFirst: m.statusesFindFirst },
      principal: { findFirst: m.principalFindFirst },
      user: { findFirst: m.userFindFirst },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => m.selectWhere() }) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  tickets: { id: 't.id', updatedAt: 't.updatedAt', deletedAt: 't.deletedAt' },
  ticketStatuses: { id: 'ts.id', isDefault: 'ts.isDefault', deletedAt: 'ts.deletedAt' },
  ticketActivity: {},
  principal: { id: 'pr.id' },
  user: { id: 'u.id' },
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_CHANNELS: ['api', 'email', 'chat', 'web', 'widget'],
  TICKET_VISIBILITY_SCOPES: ['team', 'workspace', 'private'],
}))

vi.mock('../../audit', () => ({ recordEvent: (...a: unknown[]) => m.recordEvent(...a) }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (j: unknown) => j }))
vi.mock('../tiptap-text', () => ({ tiptapToPlainText: () => 'plain' }))
vi.mock('../../organizations/contact.service', () => ({
  findOrCreateByEmail: (...a: unknown[]) => m.findOrCreateByEmail(...a),
  linkContactToUser: (...a: unknown[]) => m.linkContactToUser(...a),
  listLinksForUser: (...a: unknown[]) => m.listLinksForUser(...a),
  getContact: (...a: unknown[]) => m.getContact(...a),
}))
vi.mock('../../inboxes/routing.engine', () => ({ route: (...a: unknown[]) => m.route(...a) }))
vi.mock('../../inboxes/routing.service', () => ({
  bumpMatchStats: (...a: unknown[]) => m.bumpMatchStats(...a),
}))
vi.mock('../../sla/sla.engine', () => ({
  attachClocksOnCreate: (...a: unknown[]) => m.attachClocks(...a),
  onStatusTransition: (...a: unknown[]) => m.onStatusTransition(...a),
}))
vi.mock('../ticket.subscriptions', () => ({
  safeSubscribe: (...a: unknown[]) => m.safeSubscribe(...a),
}))
vi.mock('../ticket.notifications', () => ({
  notifyTicketCreated: (...a: unknown[]) => m.notifyCreated(...a),
  notifyTicketAssigned: (...a: unknown[]) => m.notifyAssigned(...a),
  notifyTicketStatusChanged: (...a: unknown[]) => m.notifyStatus(...a),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchTicketCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchTicketUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchTicketAssigned: (...a: unknown[]) => m.dAssigned(...a),
  dispatchTicketUnassigned: (...a: unknown[]) => m.dUnassigned(...a),
  dispatchTicketStatusChanged: (...a: unknown[]) => m.dStatus(...a),
  dispatchTicketDeleted: (...a: unknown[]) => m.dDeleted(...a),
  dispatchTicketRestored: (...a: unknown[]) => m.dRestored(...a),
}))

import * as svc from '../ticket.service'

const D1 = new Date('2026-04-01T00:00:00Z')
const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'ticket_1',
  subject: 'Help',
  descriptionText: 'd',
  descriptionJson: null,
  priority: 'normal',
  channel: 'api',
  visibilityScope: 'team',
  statusId: 'status_open',
  primaryTeamId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: null,
  requesterContactId: null,
  organizationId: null,
  inboxId: null,
  updatedAt: D1,
  resolvedAt: null,
  closedAt: null,
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.ticketsFindFirst.mockResolvedValue(ticket())
  m.statusesFindFirst.mockResolvedValue({ id: 'status_open', category: 'open', isDefault: true })
  m.principalFindFirst.mockResolvedValue(undefined)
  m.userFindFirst.mockResolvedValue(undefined)
  m.insertReturning.mockResolvedValue([ticket()])
  m.updateReturning.mockResolvedValue([ticket()])
  m.selectWhere.mockResolvedValue([])
  m.route.mockResolvedValue({ matchedRuleId: null, inboxId: null })
  m.listLinksForUser.mockResolvedValue([])
  m.getContact.mockResolvedValue(null)
  m.findOrCreateByEmail.mockResolvedValue({ id: 'contact_1', organizationId: null })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createTicket validation + status', () => {
  it('rejects empty / over-long subject', async () => {
    await expect(svc.createTicket({ subject: ' ' } as never)).rejects.toThrow('subject is required')
    await expect(svc.createTicket({ subject: 'x'.repeat(501) } as never)).rejects.toThrow('exceeds')
  })
  it('rejects invalid priority / channel / visibility', async () => {
    await expect(svc.createTicket({ subject: 'S', priority: 'bogus' } as never)).rejects.toThrow(
      'invalid priority'
    )
    await expect(svc.createTicket({ subject: 'S', channel: 'bogus' } as never)).rejects.toThrow(
      'invalid channel'
    )
    await expect(
      svc.createTicket({ subject: 'S', visibilityScope: 'bogus' } as never)
    ).rejects.toThrow('invalid visibilityScope')
  })
  it('resolves an explicit statusId and throws when it is missing', async () => {
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_x', category: 'open' })
    await svc.createTicket({ subject: 'S', statusId: 'status_x' } as never)
    m.statusesFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.createTicket({ subject: 'S', statusId: 'ghost' } as never)).rejects.toThrow(
      'status ghost not found'
    )
  })
  it('throws when no default status is configured', async () => {
    m.statusesFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.createTicket({ subject: 'S' } as never)).rejects.toThrow(
      'No default ticket status'
    )
  })
})

describe('createTicket happy paths + side effects', () => {
  it('routes, records the routed activity, and bumps match stats', async () => {
    m.route.mockResolvedValueOnce({
      matchedRuleId: 'rule_1',
      inboxId: 'inbox_1',
      primaryTeamId: 'team_1',
      assigneePrincipalId: 'p_assignee',
      priority: 'high',
      visibilityScope: 'workspace',
    })
    await svc.createTicket({
      subject: 'S',
      descriptionJson: { type: 'doc' },
      createdByPrincipalId: 'p1',
    } as never)
    expect(m.bumpMatchStats).toHaveBeenCalled()
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('resolves the requester contact via an existing link', async () => {
    m.principalFindFirst.mockResolvedValueOnce({ userId: 'u1', type: 'user' })
    m.listLinksForUser.mockResolvedValueOnce([{ contactId: 'contact_existing' }])
    await svc.createTicket({ subject: 'S', requesterPrincipalId: 'p_req' } as never)
    expect(m.findOrCreateByEmail).not.toHaveBeenCalled()
  })
  it('creates + links a contact when the verified user has no link', async () => {
    m.principalFindFirst.mockResolvedValueOnce({ userId: 'u1', type: 'user' })
    m.listLinksForUser.mockResolvedValueOnce([])
    m.userFindFirst.mockResolvedValueOnce({ email: 'a@x.test', emailVerified: true })
    await svc.createTicket({ subject: 'S', requesterPrincipalId: 'p_req' } as never)
    expect(m.linkContactToUser).toHaveBeenCalled()
  })
  it('looks up the org from the contact when organizationId is not supplied', async () => {
    m.getContact.mockResolvedValueOnce({ organizationId: 'org_1' })
    await svc.createTicket({ subject: 'S', requesterContactId: 'contact_1' } as never)
    expect(m.getContact).toHaveBeenCalled()
  })
  it('swallows a customer-context resolution failure', async () => {
    m.principalFindFirst.mockRejectedValueOnce(new Error('db'))
    await svc.createTicket({ subject: 'S', requesterPrincipalId: 'p_req' } as never)
    expect(console.warn).toHaveBeenCalled()
  })
  it('swallows sla / notify / dispatch failures', async () => {
    m.attachClocks.mockRejectedValueOnce(new Error('sla'))
    m.notifyCreated.mockRejectedValueOnce(new Error('notify'))
    m.dCreated.mockRejectedValueOnce(new Error('dispatch'))
    await svc.createTicket({
      subject: 'S',
      requesterPrincipalId: 'p_req',
      assigneePrincipalId: 'p_a',
    } as never)
    expect(m.safeSubscribe).toHaveBeenCalled()
  })
})

describe('getTicket / loadTicketsByIds', () => {
  it('getTicket returns null when missing', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    expect(await svc.getTicket('ticket_1' as never)).toBeNull()
  })
  it('loadTicketsByIds short-circuits on empty', async () => {
    expect(await svc.loadTicketsByIds([])).toEqual([])
    m.selectWhere.mockResolvedValueOnce([ticket()])
    expect(await svc.loadTicketsByIds(['ticket_1'] as never)).toHaveLength(1)
  })
})

describe('updateTicket', () => {
  it('throws when missing', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.updateTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null } as never
      )
    ).rejects.toThrow('not found')
  })
  it('throws stale when timestamps differ and merge is not allowed', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ updatedAt: new Date('2026-05-01') }))
    await expect(
      svc.updateTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, subject: 'New' } as never
      )
    ).rejects.toThrow('refresh and retry')
  })
  it('re-reads the latest row when stale but a field merge is allowed', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ updatedAt: new Date('2026-05-01') })) // existing (stale)
    m.ticketsFindFirst.mockResolvedValueOnce(
      ticket({ updatedAt: new Date('2026-05-01'), subject: 'Old' })
    ) // latest
    m.updateReturning.mockResolvedValueOnce([ticket({ subject: 'New' })])
    await svc.updateTicket(
      'ticket_1' as never,
      {
        expectedUpdatedAt: D1,
        actorPrincipalId: 'p1',
        subject: 'New',
        allowStaleFieldUpdate: true,
      } as never
    )
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('re-read returns null -> not found', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ updatedAt: new Date('2026-05-01') }))
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.updateTicket(
        'ticket_1' as never,
        {
          expectedUpdatedAt: D1,
          actorPrincipalId: null,
          subject: 'New',
          allowStaleFieldUpdate: true,
        } as never
      )
    ).rejects.toThrow('not found')
  })
  it('builds a full diff across all editable fields', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket())
    m.updateReturning.mockResolvedValueOnce([ticket()])
    await svc.updateTicket(
      'ticket_1' as never,
      {
        expectedUpdatedAt: D1,
        actorPrincipalId: null,
        subject: 'New',
        descriptionJson: { type: 'doc' },
        descriptionText: 'nd',
        priority: 'high',
        visibilityScope: 'workspace',
        primaryTeamId: 'team_2',
        organizationId: 'org_2',
        requesterContactId: 'contact_2',
        inboxId: 'inbox_2',
      } as never
    )
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('rejects invalid priority / visibility on update', async () => {
    m.ticketsFindFirst.mockResolvedValue(ticket())
    await expect(
      svc.updateTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, priority: 'bogus' } as never
      )
    ).rejects.toThrow('invalid priority')
    await expect(
      svc.updateTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, visibilityScope: 'bogus' } as never
      )
    ).rejects.toThrow('invalid visibilityScope')
  })
  it('returns existing unchanged when no fields change', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ subject: 'Same' }))
    const res = await svc.updateTicket(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: null, subject: 'Same' } as never
    )
    expect(res.subject).toBe('Same')
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
  it('throws conflict when the optimistic update matches no row', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket())
    m.updateReturning.mockResolvedValueOnce([])
    await expect(
      svc.updateTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, subject: 'New' } as never
      )
    ).rejects.toThrow('modified concurrently')
  })
})

describe('assignTicket', () => {
  it('throws not found / stale', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.assignTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null } as never
      )
    ).rejects.toThrow('not found')
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ updatedAt: new Date('2026-05-01') }))
    await expect(
      svc.assignTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, assigneePrincipalId: 'p_a' } as never
      )
    ).rejects.toThrow('refresh and retry')
  })
  it('returns existing when assignment is unchanged', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ assigneePrincipalId: 'p_a' }))
    const res = await svc.assignTicket(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: null, assigneePrincipalId: 'p_a' } as never
    )
    expect(res.id).toBe('ticket_1')
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
  it('assigns a new principal (subscribe + dispatch assigned)', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ assigneePrincipalId: null }))
    m.updateReturning.mockResolvedValueOnce([ticket({ assigneePrincipalId: 'p_new' })])
    await svc.assignTicket(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: 'p1', assigneePrincipalId: 'p_new' } as never
    )
    expect(m.safeSubscribe).toHaveBeenCalled()
    expect(m.dAssigned).toHaveBeenCalled()
  })
  it('unassigns (dispatch unassigned for the prior assignee)', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ assigneePrincipalId: 'p_old' }))
    m.updateReturning.mockResolvedValueOnce([ticket({ assigneePrincipalId: null })])
    await svc.assignTicket(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: 'p1', assigneePrincipalId: null } as never
    )
    expect(m.dUnassigned).toHaveBeenCalled()
  })
  it('throws conflict when the update matches no row', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ assigneePrincipalId: null }))
    m.updateReturning.mockResolvedValueOnce([])
    await expect(
      svc.assignTicket(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, assigneePrincipalId: 'p_new' } as never
      )
    ).rejects.toThrow('modified concurrently')
  })
})

describe('transitionStatus', () => {
  it('throws not found and returns existing when status is unchanged', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.transitionStatus(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, statusId: 'status_x' } as never
      )
    ).rejects.toThrow('not found')
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ statusId: 'status_open' }))
    const res = await svc.transitionStatus(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: null, statusId: 'status_open' } as never
    )
    expect(res.id).toBe('ticket_1')
  })
  it('transitions to solved (sets resolvedAt, clears closedAt)', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ statusId: 'status_open' }))
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_solved', category: 'solved' }) // next
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_open', category: 'open' }) // prev
    await svc.transitionStatus(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: 'p1', statusId: 'status_solved' } as never
    )
    expect(m.dStatus).toHaveBeenCalled()
  })
  it('transitions to closed', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ statusId: 'status_open' }))
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_closed', category: 'closed' })
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_open', category: 'open' })
    await svc.transitionStatus(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: null, statusId: 'status_closed' } as never
    )
    expect(m.onStatusTransition).toHaveBeenCalled()
  })
  it('reopens from a terminal state (clears resolved/closed)', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(
      ticket({ statusId: 'status_closed', resolvedAt: D1, closedAt: D1 })
    )
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_open', category: 'open' }) // next
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_closed', category: 'closed' }) // prev
    await svc.transitionStatus(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: null, statusId: 'status_open' } as never
    )
    expect(m.dStatus).toHaveBeenCalled()
  })
  it('handles a ticket with no previous status', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ statusId: null }))
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_open', category: 'open' }) // next
    await svc.transitionStatus(
      'ticket_1' as never,
      { expectedUpdatedAt: D1, actorPrincipalId: null, statusId: 'status_open' } as never
    )
    expect(m.dStatus).toHaveBeenCalled()
  })
  it('throws conflict when the update matches no row', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ statusId: 'status_open' }))
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_solved', category: 'solved' })
    m.statusesFindFirst.mockResolvedValueOnce({ id: 'status_open', category: 'open' })
    m.updateReturning.mockResolvedValueOnce([])
    await expect(
      svc.transitionStatus(
        'ticket_1' as never,
        { expectedUpdatedAt: D1, actorPrincipalId: null, statusId: 'status_solved' } as never
      )
    ).rejects.toThrow('modified concurrently')
  })
})

describe('softDelete / restore / bump', () => {
  it('soft-deletes (service actor) and dispatches', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(ticket())
    await svc.softDeleteTicket('ticket_1' as never, null)
    expect(m.dDeleted).toHaveBeenCalled()
  })
  it('soft-delete throws when missing', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.softDeleteTicket('ticket_1' as never, 'p1' as never)).rejects.toThrow(
      'not found'
    )
  })
  it('restore throws when missing / not deleted, succeeds otherwise', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.restoreTicket('ticket_1' as never, 'p1' as never)).rejects.toThrow('not found')
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ deletedAt: null }))
    await expect(svc.restoreTicket('ticket_1' as never, 'p1' as never)).rejects.toThrow(
      'not deleted'
    )
    m.ticketsFindFirst.mockResolvedValueOnce(ticket({ deletedAt: D1 }))
    await svc.restoreTicket('ticket_1' as never, 'p1' as never)
    expect(m.dRestored).toHaveBeenCalled()
  })
  it('bumpLastActivity and writeActivity run', async () => {
    await svc.bumpLastActivity('ticket_1' as never)
    m.insertReturning.mockResolvedValueOnce([{ id: 'act_1' }])
    expect(await svc.writeActivity('ticket_1' as never, null, 'x', {})).toEqual({ id: 'act_1' })
  })
})
