import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPreferencesData } from '../../domains/subscriptions/subscription.types'
import { getTicketEmailTargets } from '../ticket-targets'
import type { HookContext } from '../hook-context'
import type { EventData, EventTicketRef } from '../types'

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  getSubscribers: vi.fn(),
  resolvePortalLinkedRecipients: vi.fn(),
  resolvePrincipalsForContacts: vi.fn(),
  canViewTicket: vi.fn(),
  toResourceScope: vi.fn(),
  loadPermissionSet: vi.fn(),
  batchGenerateUnsubscribeTokens: vi.fn(),
  batchGetNotificationPreferences: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => mocks.dbSelect(...args),
  },
  eq: (...args: unknown[]) => mocks.eq(...args),
  inArray: (...args: unknown[]) => mocks.inArray(...args),
  and: (...args: unknown[]) => mocks.and(...args),
  isNull: (...args: unknown[]) => mocks.isNull(...args),
  ticketShares: {
    ticketId: 'ticketShares.ticketId',
    teamId: 'ticketShares.teamId',
    revokedAt: 'ticketShares.revokedAt',
  },
  teamMemberships: {
    teamId: 'teamMemberships.teamId',
    principalId: 'teamMemberships.principalId',
  },
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
  },
  user: {
    id: 'user.id',
    email: 'user.email',
  },
}))

vi.mock('@/lib/server/domains/tickets/ticket.subscriptions', () => ({
  getSubscribers: (...args: unknown[]) => mocks.getSubscribers(...args),
}))

vi.mock('@/lib/server/domains/tickets/ticket.recipients', () => ({
  resolvePortalLinkedRecipients: (...args: unknown[]) =>
    mocks.resolvePortalLinkedRecipients(...args),
  resolvePrincipalsForContacts: (...args: unknown[]) => mocks.resolvePrincipalsForContacts(...args),
}))

vi.mock('@/lib/server/domains/tickets/ticket.permissions', () => ({
  canViewTicket: (...args: unknown[]) => mocks.canViewTicket(...args),
  toResourceScope: (...args: unknown[]) => mocks.toResourceScope(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => mocks.loadPermissionSet(...args),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGenerateUnsubscribeTokens: (...args: unknown[]) =>
    mocks.batchGenerateUnsubscribeTokens(...args),
  batchGetNotificationPreferences: (...args: unknown[]) =>
    mocks.batchGetNotificationPreferences(...args),
}))

const context: HookContext = {
  workspaceName: 'Acme Support',
  portalBaseUrl: 'https://portal.example.com',
  logoUrl: null,
}

const ticket: EventTicketRef = {
  id: 'ticket_123',
  subject: 'Billing question',
  descriptionText: 'The invoice is missing a discount.',
  statusId: 'status_open',
  statusCategory: 'open',
  priority: 'high',
  channel: 'email',
  visibility: 'team',
  inboxId: 'inbox_1',
  primaryTeamId: 'team_1',
  assigneePrincipalId: 'principal_assignee',
  assigneeTeamId: null,
  requesterPrincipalId: 'principal_requester',
  requesterContactId: 'contact_1',
  statusName: 'Open',
  inboxName: 'Support',
}

function selectRows(rows: ReadonlyArray<Record<string, unknown>>) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(async () => rows),
  }
  return chain
}

function queueSelects(...rowSets: Array<ReadonlyArray<Record<string, unknown>>>) {
  for (const rows of rowSets) {
    mocks.dbSelect.mockReturnValueOnce(selectRows(rows))
  }
}

function pref(overrides: Partial<NotificationPreferencesData> = {}): NotificationPreferencesData {
  return {
    emailStatusChange: true,
    emailNewComment: true,
    emailMuted: false,
    emailTicketThreads: true,
    emailTicketProperties: true,
    emailTicketStatus: true,
    emailTicketAssignment: true,
    emailTicketParticipants: true,
    emailTicketShares: true,
    emailTicketSla: true,
    ...overrides,
  }
}

function prefsFor(
  entries: Array<[string, Partial<NotificationPreferencesData>?]>
): Map<string, NotificationPreferencesData> {
  return new Map(entries.map(([principalId, overrides]) => [principalId, pref(overrides)]))
}

function emailRow(principalId: string, email: string | null) {
  return { principalId, email }
}

type ResolvedTargets = Awaited<ReturnType<typeof getTicketEmailTargets>>
type ResolvedTarget = ResolvedTargets[number]
type EmailTarget = ResolvedTarget & {
  target: { email: string | null; unsubscribeUrl?: string }
  config: Record<string, unknown>
}

function asEmailTarget(target: ResolvedTarget): EmailTarget {
  return target as EmailTarget
}

function emailAddresses(targets: ResolvedTargets) {
  return targets.map((target) => asEmailTarget(target).target.email)
}

function firstEmailTarget(targets: ResolvedTargets): EmailTarget {
  expect(targets[0]).toBeDefined()
  return asEmailTarget(targets[0] as ResolvedTarget)
}

function identityRow(id: string, userId: string | null) {
  return { id, userId }
}

function event(type: string, data: Record<string, unknown> = {}): EventData {
  return {
    id: `event_${type}`,
    type,
    timestamp: '2026-06-16T12:00:00.000Z',
    actor: {
      type: 'user',
      principalId: 'principal_actor',
      displayName: 'Alex Agent',
      email: 'alex@example.com',
    },
    data: { ticket, ...data },
  } as EventData
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSubscribers.mockResolvedValue([])
  mocks.resolvePortalLinkedRecipients.mockResolvedValue({
    principalIds: [],
    portalLinked: new Set<string>(),
  })
  mocks.resolvePrincipalsForContacts.mockResolvedValue([])
  mocks.toResourceScope.mockReturnValue({ resource: 'ticket_123' })
  mocks.loadPermissionSet.mockImplementation(async (principalId: string) => ({ principalId }))
  mocks.canViewTicket.mockReturnValue(true)
  mocks.batchGenerateUnsubscribeTokens.mockResolvedValue(new Map())
  mocks.batchGetNotificationPreferences.mockResolvedValue(new Map())
})

describe('getTicketEmailTargets', () => {
  it('does not resolve recipients without a ticket payload or subscription category', async () => {
    await expect(
      getTicketEmailTargets({ ...event('post.created'), data: {} } as EventData, context)
    ).resolves.toEqual([])
    await expect(getTicketEmailTargets(event('ticket.custom'), context)).resolves.toEqual([])

    expect(mocks.getSubscribers).not.toHaveBeenCalled()
    expect(mocks.dbSelect).not.toHaveBeenCalled()
  })

  it('delivers public thread emails to subscribers, assignees, requester owners, and portal-linked owners', async () => {
    mocks.resolvePortalLinkedRecipients.mockResolvedValue({
      principalIds: ['principal_linked'],
      portalLinked: new Set(['principal_linked']),
    })
    mocks.getSubscribers.mockResolvedValue(['principal_subscriber', 'principal_actor'])
    mocks.batchGetNotificationPreferences.mockResolvedValue(
      prefsFor([
        ['principal_subscriber'],
        ['principal_requester'],
        ['principal_assignee'],
        ['principal_linked'],
      ])
    )
    queueSelects(
      [{ teamId: 'team_shared', revokedAt: null }],
      [
        identityRow('principal_subscriber', 'user_subscriber'),
        identityRow('principal_requester', 'user_requester'),
        identityRow('principal_assignee', 'user_assignee'),
        identityRow('principal_linked', 'user_linked'),
      ],
      [],
      [
        emailRow('principal_subscriber', 'subscriber@example.com'),
        emailRow('principal_requester', 'requester@example.com'),
        emailRow('principal_assignee', 'assignee@example.com'),
        emailRow('principal_linked', 'linked@example.com'),
      ]
    )

    const targets = await getTicketEmailTargets(
      event('ticket.thread_added', {
        audience: 'public',
        thread: {
          bodyText: 'A customer-facing reply.',
          bodyTextPreview: 'A customer-facing reply.',
          isFromRequester: false,
          createdAt: '2026-06-16T12:00:00.000Z',
        },
      }),
      context
    )

    expect(emailAddresses(targets)).toEqual([
      'subscriber@example.com',
      'requester@example.com',
      'assignee@example.com',
      'linked@example.com',
    ])
    expect(emailAddresses(targets)).not.toContain('actor@example.com')
    expect(firstEmailTarget(targets).target.unsubscribeUrl).toBe(
      'https://portal.example.com/settings/notifications'
    )
    expect(firstEmailTarget(targets).config).toMatchObject({
      workspaceName: 'Acme Support',
      eventLabel: 'New reply',
      ticketSubject: 'Billing question',
      priorityLabel: 'high',
    })
    expect(mocks.toResourceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryTeamId: 'team_1',
        assigneePrincipalId: 'principal_assignee',
        shares: [{ teamId: 'team_shared', revokedAt: null }],
      })
    )
    expect(mocks.batchGenerateUnsubscribeTokens).toHaveBeenCalledWith([
      expect.objectContaining({ principalId: 'principal_subscriber' }),
      expect.objectContaining({ principalId: 'principal_requester' }),
      expect.objectContaining({ principalId: 'principal_assignee' }),
      expect.objectContaining({ principalId: 'principal_linked' }),
    ])
  })

  it('keeps internal thread emails away from requester and portal-linked recipients', async () => {
    mocks.resolvePortalLinkedRecipients.mockResolvedValue({
      principalIds: ['principal_linked'],
      portalLinked: new Set(['principal_linked']),
    })
    mocks.getSubscribers.mockResolvedValue([
      'principal_subscriber',
      'principal_requester',
      'principal_linked',
      'principal_actor',
    ])
    mocks.batchGetNotificationPreferences.mockResolvedValue(
      prefsFor([['principal_subscriber'], ['principal_assignee']])
    )
    queueSelects(
      [],
      [
        identityRow('principal_subscriber', 'user_subscriber'),
        identityRow('principal_assignee', 'user_assignee'),
      ],
      [],
      [
        emailRow('principal_subscriber', 'subscriber@example.com'),
        emailRow('principal_assignee', 'assignee@example.com'),
      ]
    )

    const targets = await getTicketEmailTargets(
      event('ticket.thread_added', {
        audience: 'internal',
        thread: {
          bodyText: 'Internal agent note.',
          bodyTextPreview: 'Internal agent note.',
          isFromRequester: false,
          createdAt: '2026-06-16T12:00:00.000Z',
        },
      }),
      context
    )

    expect(emailAddresses(targets)).toEqual(['subscriber@example.com', 'assignee@example.com'])
    expect(mocks.batchGetNotificationPreferences).toHaveBeenCalledWith([
      'principal_subscriber',
      'principal_assignee',
    ])
  })

  it('trusts principals linked from added participant contacts without requiring ticket grants', async () => {
    mocks.resolvePrincipalsForContacts.mockResolvedValue(['principal_contact'])
    mocks.canViewTicket.mockReturnValue(false)
    mocks.batchGetNotificationPreferences.mockResolvedValue(prefsFor([['principal_contact']]))
    queueSelects(
      [],
      [
        identityRow('principal_direct', 'user_direct'),
        identityRow('principal_contact', 'user_contact'),
      ],
      [],
      [emailRow('principal_contact', 'contact@example.com')]
    )

    const targets = await getTicketEmailTargets(
      event('ticket.participant_added', {
        addedPrincipalId: 'principal_direct',
        addedContactId: 'contact_linked',
        role: 'cc',
      }),
      context
    )

    expect(emailAddresses(targets)).toEqual(['contact@example.com'])
    expect(mocks.resolvePrincipalsForContacts).toHaveBeenCalledWith(['contact_linked'])
    expect(mocks.loadPermissionSet).toHaveBeenCalledWith('principal_direct')
    expect(mocks.loadPermissionSet).not.toHaveBeenCalledWith('principal_contact')
  })

  it('expands share events to team members and honors share notification preferences', async () => {
    mocks.getSubscribers.mockResolvedValue(['principal_subscriber'])
    mocks.batchGetNotificationPreferences.mockResolvedValue(
      prefsFor([['principal_member'], ['principal_subscriber', { emailTicketShares: false }]])
    )
    queueSelects(
      [{ principalId: 'principal_member' }, { principalId: 'principal_actor' }],
      [],
      [
        identityRow('principal_subscriber', 'user_subscriber'),
        identityRow('principal_member', 'user_member'),
      ],
      [],
      [emailRow('principal_member', 'member@example.com')]
    )

    const targets = await getTicketEmailTargets(
      event('ticket.shared', {
        teamId: 'team_shared',
        accessLevel: 'comment',
      }),
      context
    )

    expect(mocks.getSubscribers).toHaveBeenCalledWith('ticket_123', 'shares')
    expect(emailAddresses(targets)).toEqual(['member@example.com'])
  })

  it('allows a subscribed principal when any sibling principal for the same user can view the ticket', async () => {
    const scopedTicket = { ...ticket, requesterPrincipalId: null, assigneePrincipalId: null }
    mocks.getSubscribers.mockResolvedValue(['principal_subscriber'])
    mocks.canViewTicket.mockImplementation(
      (set: { principalId: string }) => set.principalId === 'principal_sibling'
    )
    mocks.batchGetNotificationPreferences.mockResolvedValue(prefsFor([['principal_subscriber']]))
    queueSelects(
      [],
      [identityRow('principal_subscriber', 'user_shared')],
      [
        identityRow('principal_subscriber', 'user_shared'),
        identityRow('principal_sibling', 'user_shared'),
      ],
      [emailRow('principal_subscriber', 'subscriber@example.com')]
    )

    const targets = await getTicketEmailTargets(
      event('ticket.status_changed', {
        ticket: scopedTicket,
        previousStatusCategory: 'open',
        newStatusCategory: 'closed',
      }),
      context
    )

    expect(emailAddresses(targets)).toEqual(['subscriber@example.com'])
    expect(mocks.loadPermissionSet).toHaveBeenCalledWith('principal_subscriber')
    expect(mocks.loadPermissionSet).toHaveBeenCalledWith('principal_sibling')
  })

  it('filters muted recipients, disabled event preferences, and missing email addresses', async () => {
    const scopedTicket = { ...ticket, requesterPrincipalId: null, assigneePrincipalId: null }
    mocks.getSubscribers.mockResolvedValue([
      'principal_muted',
      'principal_disabled',
      'principal_without_email',
    ])
    mocks.batchGetNotificationPreferences.mockResolvedValue(
      prefsFor([
        ['principal_muted', { emailMuted: true }],
        ['principal_disabled', { emailTicketStatus: false }],
        ['principal_without_email'],
      ])
    )
    queueSelects(
      [],
      [
        identityRow('principal_muted', 'user_muted'),
        identityRow('principal_disabled', 'user_disabled'),
        identityRow('principal_without_email', 'user_without_email'),
      ],
      [],
      [emailRow('principal_without_email', null)]
    )

    const targets = await getTicketEmailTargets(
      event('ticket.status_changed', {
        ticket: scopedTicket,
        previousStatusCategory: 'open',
        newStatusCategory: 'closed',
      }),
      context
    )

    expect(targets).toEqual([])
    expect(mocks.batchGenerateUnsubscribeTokens).not.toHaveBeenCalled()
  })
})
