/**
 * Differential-coverage tests for ticket.notifications — the shared dispatch
 * core (actor suppression, dedup, trusted-recipient bypass, canViewTicket gate
 * + permission-failure swallow, empty short-circuits) and each event
 * dispatcher (created/assigned/status/thread audience/participant/share/sla).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  selectWhere: vi.fn(),
  createBatch: vi.fn((..._a: unknown[]) => Promise.resolve()),
  getSubscribers: vi.fn(),
  canViewTicket: vi.fn(),
  toResourceScope: vi.fn(),
  loadPermissionSet: vi.fn(),
  resolvePortalLinked: vi.fn(),
  resolvePrincipalsForContacts: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => m.selectWhere() }) }) },
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  ticketShares: { ticketId: 'ts.ticketId', teamId: 'ts.teamId', revokedAt: 'ts.revokedAt' },
  teamMemberships: { teamId: 'tm.teamId', principalId: 'tm.principalId' },
}))
vi.mock('../../notifications/notification.service', () => ({
  createNotificationsBatch: (...a: unknown[]) => m.createBatch(...a),
}))
vi.mock('../ticket.subscriptions', () => ({
  getSubscribers: (...a: unknown[]) => m.getSubscribers(...a),
}))
vi.mock('../ticket.permissions', () => ({
  canViewTicket: (...a: unknown[]) => m.canViewTicket(...a),
  toResourceScope: (...a: unknown[]) => m.toResourceScope(...a),
}))
vi.mock('../../authz/authz.service', () => ({
  loadPermissionSet: (...a: unknown[]) => m.loadPermissionSet(...a),
}))
vi.mock('../ticket.recipients', () => ({
  resolvePortalLinkedRecipients: (...a: unknown[]) => m.resolvePortalLinked(...a),
  resolvePrincipalsForContacts: (...a: unknown[]) => m.resolvePrincipalsForContacts(...a),
}))

import * as svc from '../ticket.notifications'

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'ticket_1',
  subject: 'Help',
  primaryTeamId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: null,
  ...over,
})
const ctx = (actorPrincipalId: string | null = null) => ({ actorPrincipalId }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.selectWhere.mockResolvedValue([])
  m.createBatch.mockResolvedValue(undefined)
  m.getSubscribers.mockResolvedValue(['sub_1'])
  m.canViewTicket.mockReturnValue(true)
  m.toResourceScope.mockReturnValue({})
  m.loadPermissionSet.mockResolvedValue({})
  m.resolvePortalLinked.mockResolvedValue({ principalIds: [], portalLinked: new Set() })
  m.resolvePrincipalsForContacts.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('notifyTicketCreated + dispatch core', () => {
  it('returns early when there are no recipients', async () => {
    m.getSubscribers.mockResolvedValueOnce([])
    await svc.notifyTicketCreated(ticket() as never, ctx())
    expect(m.createBatch).not.toHaveBeenCalled()
  })
  it('dispatches to allowed subscribers', async () => {
    await svc.notifyTicketCreated(ticket() as never, ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('suppresses the actor and returns when nobody else remains', async () => {
    m.getSubscribers.mockResolvedValueOnce(['actor_p'])
    await svc.notifyTicketCreated(ticket() as never, ctx('actor_p'))
    expect(m.createBatch).not.toHaveBeenCalled()
  })
  it('trusts owning recipients without a permission check', async () => {
    m.canViewTicket.mockReturnValue(false) // RBAC would deny
    m.getSubscribers.mockResolvedValueOnce([])
    m.resolvePortalLinked.mockResolvedValueOnce({
      principalIds: ['p_req'],
      portalLinked: new Set(['p_req']),
    })
    await svc.notifyTicketCreated(ticket({ requesterPrincipalId: 'p_req' }) as never, ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('drops recipients who fail the permission check', async () => {
    m.canViewTicket.mockReturnValue(false)
    await svc.notifyTicketCreated(ticket() as never, ctx())
    expect(m.createBatch).not.toHaveBeenCalled()
  })
  it('swallows a permission-check failure', async () => {
    m.loadPermissionSet.mockRejectedValue(new Error('authz down'))
    await svc.notifyTicketCreated(ticket() as never, ctx())
    expect(console.warn).toHaveBeenCalled()
    expect(m.createBatch).not.toHaveBeenCalled()
  })
})

describe('notifyTicketAssigned', () => {
  it('notifies a new assignee', async () => {
    await svc.notifyTicketAssigned(ticket({ assigneePrincipalId: 'p_new' }) as never, null, ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('notifies the previous assignee on unassign', async () => {
    await svc.notifyTicketAssigned(
      ticket({ assigneePrincipalId: null }) as never,
      'p_old' as never,
      ctx()
    )
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('does nothing when there is no new or previous assignee', async () => {
    await svc.notifyTicketAssigned(ticket({ assigneePrincipalId: null }) as never, null, ctx())
    expect(m.createBatch).not.toHaveBeenCalled()
  })
})

describe('notifyTicketStatusChanged', () => {
  it('dispatches with a from→to body', async () => {
    await svc.notifyTicketStatusChanged(ticket() as never, 'open', 'solved', ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('returns early when there are no recipients', async () => {
    m.getSubscribers.mockResolvedValueOnce([])
    await svc.notifyTicketStatusChanged(ticket() as never, null, 'open', ctx())
    expect(m.createBatch).not.toHaveBeenCalled()
  })
})

describe('notifyThreadAdded audience handling', () => {
  it('public: includes portal-linked and trusts them', async () => {
    m.resolvePortalLinked.mockResolvedValueOnce({
      principalIds: ['p_portal'],
      portalLinked: new Set(['p_portal']),
    })
    await svc.notifyThreadAdded(ticket() as never, 'thread_1', 'public', null, ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('internal: drops requester + portal-linked', async () => {
    m.resolvePortalLinked.mockResolvedValueOnce({
      principalIds: [],
      portalLinked: new Set(['p_portal']),
    })
    m.getSubscribers.mockResolvedValueOnce(['p_portal', 'p_req', 'agent_1'])
    await svc.notifyThreadAdded(
      ticket({ requesterPrincipalId: 'p_req' }) as never,
      'thread_1',
      'internal',
      null,
      ctx()
    )
    expect(m.createBatch).toHaveBeenCalled() // agent_1 survives
  })
  it('returns early when the audience filter empties the set', async () => {
    m.resolvePortalLinked.mockResolvedValueOnce({
      principalIds: [],
      portalLinked: new Set(['p_req']),
    })
    m.getSubscribers.mockResolvedValueOnce(['p_req'])
    await svc.notifyThreadAdded(
      ticket({ requesterPrincipalId: 'p_req' }) as never,
      'thread_1',
      'shared_team',
      'team_1' as never,
      ctx()
    )
    expect(m.createBatch).not.toHaveBeenCalled()
  })
})

describe('participant notifications', () => {
  it('added: notifies a direct principal', async () => {
    await svc.notifyParticipantAdded(
      ticket() as never,
      { principalId: 'p_added', contactId: null } as never,
      ctx()
    )
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('added: resolves a contact to linked principals (trusted)', async () => {
    m.resolvePrincipalsForContacts.mockResolvedValueOnce(['p_linked'])
    await svc.notifyParticipantAdded(
      ticket() as never,
      { principalId: null, contactId: 'contact_1' } as never,
      ctx()
    )
    expect(m.resolvePrincipalsForContacts).toHaveBeenCalled()
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('added: no-ops when neither a principal nor a linked contact exists', async () => {
    await svc.notifyParticipantAdded(
      ticket() as never,
      { principalId: null, contactId: null } as never,
      ctx()
    )
    expect(m.createBatch).not.toHaveBeenCalled()
  })
  it('removed: notifies the removed principal', async () => {
    await svc.notifyParticipantRemoved(
      ticket() as never,
      { principalId: 'p_removed', contactId: null } as never,
      ctx()
    )
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('removed: no-ops when nothing to notify', async () => {
    await svc.notifyParticipantRemoved(
      ticket() as never,
      { principalId: null, contactId: null } as never,
      ctx()
    )
    expect(m.createBatch).not.toHaveBeenCalled()
  })
})

describe('share + sla notifications', () => {
  it('shared: notifies team members', async () => {
    m.selectWhere.mockResolvedValueOnce([{ principalId: 'tm_1' }]) // expandTeamMembers
    await svc.notifyTicketShared(ticket() as never, 'team_1' as never, ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('shared: returns early with no recipients', async () => {
    m.selectWhere.mockResolvedValueOnce([]) // no team members
    m.getSubscribers.mockResolvedValueOnce([])
    await svc.notifyTicketShared(ticket() as never, 'team_1' as never, ctx())
    expect(m.createBatch).not.toHaveBeenCalled()
  })
  it('unshared: notifies team members', async () => {
    m.selectWhere.mockResolvedValueOnce([{ principalId: 'tm_1' }])
    await svc.notifyTicketUnshared(ticket() as never, 'team_1' as never, ctx())
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('sla warning: returns early with no explicit recipients', async () => {
    await svc.notifyTicketSlaWarning(ticket() as never, 'first_response', 'Rule', [])
    expect(m.createBatch).not.toHaveBeenCalled()
  })
  it('sla warning: dispatches to recipients + subscribers', async () => {
    await svc.notifyTicketSlaWarning(ticket() as never, 'first_response', 'Rule', [
      'p_oncall',
    ] as never)
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('sla breach: includes the assignee + subscribers', async () => {
    await svc.notifyTicketSlaBreach(
      ticket({ assigneePrincipalId: 'p_assignee' }) as never,
      'resolution'
    )
    expect(m.createBatch).toHaveBeenCalled()
  })
  it('sla breach: returns early when there are no recipients', async () => {
    m.getSubscribers.mockResolvedValueOnce([])
    await svc.notifyTicketSlaBreach(ticket({ assigneePrincipalId: null }) as never, 'resolution')
    expect(m.createBatch).not.toHaveBeenCalled()
  })
})
