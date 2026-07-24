/**
 * Target resolution for the ticket + SLA lifecycle EMAIL builders
 * (getTicketCreatedEmailTargets, getTicketRepliedEmailTargets,
 * getTicketResolvedEmailTargets, getTicketAssignedEmailTargets,
 * getSlaEmailTargets). Mocks the pure seams — support flag, watcher service,
 * team roster, channel-account From resolution, reply-to minting, stage labels,
 * preference matrix — and drives a flexible db.select() chain that yields one
 * queued result per select() call (FIFO), so email/ticket-fact/conversation
 * lookups return exactly what each case wants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

// --- db: flexible chainable select() consuming a FIFO of result rows ---
const selectQueue: unknown[][] = []
function queueSelect(rows: unknown[]): void {
  selectQueue.push(rows)
}
const mockSelect = vi.fn((..._args: unknown[]) => {
  const rows = selectQueue.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'limit', 'orderBy']) {
    chain[m] = () => chain
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej)
  return chain
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}))

// --- support flag ---
const isSupportTicketsEnabled = vi.fn<() => Promise<boolean>>()
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isSupportTicketsEnabled: () => isSupportTicketsEnabled(),
}))

// --- watcher service ---
const getTicketWatchersForEvent = vi.fn<() => Promise<string[]>>()
vi.mock('@/lib/server/domains/tickets/ticket-subscription.service', () => ({
  getTicketWatchersForEvent: () => getTicketWatchersForEvent(),
  getTicketAgentWatchersForEvent: vi.fn().mockResolvedValue([]),
}))

// --- team roster ---
const listTeamMemberPrincipalIds = vi.fn<() => Promise<string[]>>()
vi.mock('@/lib/server/domains/teams', () => ({
  listTeamMemberPrincipalIds: () => listTeamMemberPrincipalIds(),
}))

// --- channel-account From resolution ---
const resolveSendingAddress = vi.fn<() => Promise<string | null>>()
vi.mock('@/lib/server/domains/channel-accounts/channel-account.service', () => ({
  resolveSendingAddress: () => resolveSendingAddress(),
}))

// --- reply-to minting ---
const inboundTicketReplyToAddress = vi.fn<() => string | null>()
vi.mock('@/lib/server/domains/conversation/conversation.email-channel', () => ({
  inboundTicketReplyToAddress: () => inboundTicketReplyToAddress(),
}))

// --- stage labels ---
const getStageLabels = vi.fn<() => Promise<Record<string, string>>>()
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: () => getStageLabels(),
}))

// --- preference matrix ---
const batchGetNotificationPreferences = vi.fn<(ids: string[]) => Promise<Map<string, unknown>>>()
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: (ids: string[]) => batchGetNotificationPreferences(ids),
}))

const {
  getTicketCreatedEmailTargets,
  getTicketRepliedEmailTargets,
  getTicketResolvedEmailTargets,
  getTicketAssignedEmailTargets,
  getSlaEmailTargets,
} = await import('../targets')

const context: HookContext = {
  portalBaseUrl: 'https://p',
  workspaceName: 'W',
  logoUrl: null,
} as unknown as HookContext

beforeEach(() => {
  selectQueue.length = 0
  isSupportTicketsEnabled.mockReset().mockResolvedValue(true)
  getTicketWatchersForEvent.mockReset().mockResolvedValue([])
  listTeamMemberPrincipalIds.mockReset().mockResolvedValue([])
  resolveSendingAddress.mockReset().mockResolvedValue(null)
  inboundTicketReplyToAddress.mockReset().mockReturnValue(null)
  getStageLabels.mockReset().mockResolvedValue({ received: 'Received', resolved: 'Resolved' })
  batchGetNotificationPreferences.mockReset().mockResolvedValue(new Map())
})

/** Preferences map that denies email for one matrix key. */
function denyEmail(id: string, key: string): Map<string, unknown> {
  return new Map([[id, { matrix: { [key]: { email: false } } }]])
}

// ============================================================================
// created
// ============================================================================

const createdTicket = {
  id: 'ticket_1',
  number: 1,
  type: 'customer' as const,
  priority: 'none' as const,
  title: 'Cannot log in',
  status: 'open' as const,
  stage: 'received',
  requesterPrincipalId: 'principal_requester',
  assignedTeamId: null,
  companyId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  resolvedAt: null,
}

function createdEvent(ticketOverrides: Record<string, unknown> = {}): EventData {
  return {
    id: 'evt-c',
    type: 'ticket.created',
    timestamp: '2026-01-01T00:00:00Z',
    // Actor IS the requester — created uniquely does NOT exclude the actor.
    actor: { type: 'user', principalId: 'principal_requester' },
    data: { ticket: { ...createdTicket, ...ticketOverrides } },
  } as EventData
}

describe('getTicketCreatedEmailTargets', () => {
  it('emails the requester even when the requester is the actor (no actor exclusion)', async () => {
    queueSelect([{ id: 'principal_requester', email: 'req@example.com', contactEmail: null }])
    queueSelect([{ conversationId: 'conversation_1' }]) // the pair (requester CTA target)
    const targets = await getTicketCreatedEmailTargets(createdEvent(), context)
    expect(targets).toHaveLength(1)
    expect(targets[0].type).toBe('email')
    expect(targets[0].target).toEqual({ email: 'req@example.com', unsubscribeUrl: '' })
    expect(targets[0].config).toMatchObject({
      kind: 'created',
      ticketLabel: '#1',
      title: 'Cannot log in',
      // Converged Messages: the requester CTA is the pair's conversation.
      ctaUrl: 'https://p/support/conversation_1',
      ticketId: 'ticket_1',
      workspaceName: 'W',
    })
  })

  it('returns [] when there is no requester', async () => {
    // Payload lacks a requester → re-reads the row, which also has none.
    queueSelect([{ requesterPrincipalId: null, title: 'Cannot log in', assigneeTeamId: null }])
    expect(
      await getTicketCreatedEmailTargets(createdEvent({ requesterPrincipalId: null }), context)
    ).toEqual([])
  })

  it('returns [] when the requester email is synthetic-anon', async () => {
    queueSelect([
      { id: 'principal_requester', email: 'temp-x@anon.quackback.io', contactEmail: null },
    ])
    expect(await getTicketCreatedEmailTargets(createdEvent(), context)).toEqual([])
  })

  it('returns [] when the support flag is off', async () => {
    isSupportTicketsEnabled.mockResolvedValue(false)
    expect(await getTicketCreatedEmailTargets(createdEvent(), context)).toEqual([])
  })

  it('returns [] when the ticket_created matrix cell denies email', async () => {
    queueSelect([{ id: 'principal_requester', email: 'req@example.com', contactEmail: null }])
    batchGetNotificationPreferences.mockResolvedValue(
      denyEmail('principal_requester', 'ticket_created')
    )
    expect(await getTicketCreatedEmailTargets(createdEvent(), context)).toEqual([])
  })

  it('falls back to principal contactEmail when the account email is anon', async () => {
    queueSelect([
      { id: 'principal_requester', email: 'temp-x@anon.quackback.io', contactEmail: 'real@x.com' },
    ])
    const targets = await getTicketCreatedEmailTargets(createdEvent(), context)
    expect(targets[0].target).toMatchObject({ email: 'real@x.com' })
  })

  it('carries the per-team From and signed reply-to when configured', async () => {
    queueSelect([{ id: 'principal_requester', email: 'req@example.com', contactEmail: null }])
    resolveSendingAddress.mockResolvedValue('support@team.example')
    inboundTicketReplyToAddress.mockReturnValue('reply+tkt-1.sig@inbound.example')
    const targets = await getTicketCreatedEmailTargets(createdEvent(), context)
    expect(targets[0].config).toMatchObject({
      from: 'support@team.example',
      replyTo: 'reply+tkt-1.sig@inbound.example',
    })
  })
})

// ============================================================================
// replied
// ============================================================================

const repliedTicketRef = {
  id: 'ticket_1',
  number: 1,
  type: 'customer' as const,
  priority: 'none' as const,
  assignedTeamId: null,
}

function repliedEvent(overrides: Record<string, unknown> = {}): EventData {
  return {
    id: 'evt-r',
    type: 'ticket.replied',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_agent_actor' },
    data: {
      ticket: repliedTicketRef,
      messageId: 'conversation_message_1',
      content: 'Fix is queued.',
      attachments: null,
      senderType: 'agent',
      title: 'Cannot log in',
      authorName: 'Sarah',
      requesterPrincipalId: 'principal_requester',
      ...overrides,
    },
  } as EventData
}

describe('getTicketRepliedEmailTargets', () => {
  it('returns [] for a visitor-sent reply', async () => {
    expect(
      await getTicketRepliedEmailTargets(repliedEvent({ senderType: 'visitor' }), context)
    ).toEqual([])
  })

  it('emails the requester (portal CTA) and agent watchers (inbox CTA), actor excluded', async () => {
    getTicketWatchersForEvent.mockResolvedValue([
      'principal_requester',
      'principal_agent_1',
      'principal_agent_actor',
    ])
    queueSelect([
      { id: 'principal_requester', email: 'req@example.com', contactEmail: null },
      { id: 'principal_agent_1', email: 'agent1@example.com', contactEmail: null },
    ])
    queueSelect([{ conversationId: 'conversation_1' }]) // the pair (requester CTA target)
    const targets = await getTicketRepliedEmailTargets(repliedEvent(), context)
    expect(targets).toHaveLength(2)
    const byEmail = Object.fromEntries(
      targets.map((t) => [(t.target as { email: string }).email, t.config])
    )
    expect(byEmail['req@example.com']).toMatchObject({
      kind: 'reply',
      ctaUrl: 'https://p/support/conversation_1',
      messageBody: 'Fix is queued.',
      authorName: 'Sarah',
    })
    expect(byEmail['agent1@example.com']).toMatchObject({
      kind: 'reply',
      ctaUrl: 'https://p/admin/inbox?i=ticket_1',
      messageBody: 'Fix is queued.',
    })
    // Agent-facing target has no reply-by-email address.
    expect(byEmail['agent1@example.com']).not.toHaveProperty('replyTo', expect.anything())
  })

  it('drops a synthetic-anon requester', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_requester'])
    queueSelect([
      { id: 'principal_requester', email: 'temp-x@anon.quackback.io', contactEmail: null },
    ])
    expect(await getTicketRepliedEmailTargets(repliedEvent(), context)).toEqual([])
  })

  it('returns [] when the support flag is off', async () => {
    isSupportTicketsEnabled.mockResolvedValue(false)
    expect(await getTicketRepliedEmailTargets(repliedEvent(), context)).toEqual([])
  })

  it('returns [] when emailMuted / matrix denies the only recipient', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_requester'])
    queueSelect([{ id: 'principal_requester', email: 'req@example.com', contactEmail: null }])
    batchGetNotificationPreferences.mockResolvedValue(
      new Map([['principal_requester', { emailMuted: true }]])
    )
    expect(await getTicketRepliedEmailTargets(repliedEvent(), context)).toEqual([])
  })
})

// ============================================================================
// resolved (ticket.status_changed into closed)
// ============================================================================

function statusEvent(overrides: Record<string, unknown> = {}): EventData {
  return {
    id: 'evt-s',
    type: 'ticket.status_changed',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_agent_actor' },
    data: {
      ticket: repliedTicketRef,
      previousStatus: 'open',
      newStatus: 'closed',
      stage: 'resolved',
      previousStage: 'received',
      requesterPrincipalId: 'principal_requester',
      title: 'Cannot log in',
      ...overrides,
    },
  } as EventData
}

describe('getTicketResolvedEmailTargets', () => {
  it('fires on open→closed and emails the watching requester with stage labels', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_requester'])
    queueSelect([{ id: 'principal_requester', email: 'req@example.com', contactEmail: null }])
    queueSelect([{ conversationId: 'conversation_1' }]) // the pair (requester CTA target)
    const targets = await getTicketResolvedEmailTargets(statusEvent(), context)
    expect(targets).toHaveLength(1)
    expect(targets[0].config).toMatchObject({
      kind: 'status_resolved',
      ctaUrl: 'https://p/support/conversation_1',
      statusChange: { previousLabel: 'Received', newLabel: 'Resolved' },
    })
    // A staged (resolved) close is not the generic-close copy branch.
    expect(targets[0].config.closedGeneric).not.toBe(true)
  })

  it('B18: an unwatched requester (row deleted via "Stop watching") is NOT emailed', async () => {
    // Watcher set stays empty (the default) even though the payload names a requester.
    expect(await getTicketResolvedEmailTargets(statusEvent(), context)).toEqual([])
  })

  it('B22: a null-stage close emails with the generic Closed label + closedGeneric copy', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_requester'])
    queueSelect([{ id: 'principal_requester', email: 'req@example.com', contactEmail: null }])
    const targets = await getTicketResolvedEmailTargets(statusEvent({ stage: null }), context)
    expect(targets).toHaveLength(1)
    expect(targets[0].config).toMatchObject({
      kind: 'status_resolved',
      statusChange: { previousLabel: 'Received', newLabel: 'Closed' },
      closedGeneric: true,
    })
  })

  it('is silent on open→pending', async () => {
    expect(
      await getTicketResolvedEmailTargets(statusEvent({ newStatus: 'pending' }), context)
    ).toEqual([])
  })

  it('is silent on closed→closed', async () => {
    expect(
      await getTicketResolvedEmailTargets(statusEvent({ previousStatus: 'closed' }), context)
    ).toEqual([])
  })

  it('returns [] with no requester and no watchers', async () => {
    expect(
      await getTicketResolvedEmailTargets(statusEvent({ requesterPrincipalId: null }), context)
    ).toEqual([])
  })
})

// ============================================================================
// assigned
// ============================================================================

function assignedEvent(overrides: Record<string, unknown> = {}): EventData {
  return {
    id: 'evt-a',
    type: 'ticket.assigned',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_actor' },
    data: {
      ticket: { ...repliedTicketRef, title: 'Cannot log in' },
      assignedPrincipalId: null,
      previousPrincipalId: null,
      assignedTeamId: null,
      previousTeamId: null,
      ...overrides,
    },
  } as EventData
}

describe('getTicketAssignedEmailTargets', () => {
  it('emails the direct assignee with kind "assigned"', async () => {
    queueSelect([{ id: 'principal_assignee', email: 'assignee@example.com', contactEmail: null }])
    queueSelect([{ requesterPrincipalId: null, title: 'Cannot log in', assigneeTeamId: null }])
    const targets = await getTicketAssignedEmailTargets(
      assignedEvent({ assignedPrincipalId: 'principal_assignee' }),
      context
    )
    expect(targets).toHaveLength(1)
    expect(targets[0].config).toMatchObject({
      kind: 'assigned',
      ctaUrl: 'https://p/admin/inbox?i=ticket_1',
    })
  })

  it('emails newly-assigned team members with kind "assigned_team", actor excluded', async () => {
    listTeamMemberPrincipalIds.mockResolvedValue(['principal_member_1', 'principal_actor'])
    queueSelect([{ id: 'principal_member_1', email: 'member1@example.com', contactEmail: null }])
    queueSelect([{ requesterPrincipalId: null, title: 'Cannot log in', assigneeTeamId: null }])
    const targets = await getTicketAssignedEmailTargets(
      assignedEvent({ assignedTeamId: 'team_1' }),
      context
    )
    expect(targets).toHaveLength(1)
    expect(targets[0].target).toMatchObject({ email: 'member1@example.com' })
    expect(targets[0].config).toMatchObject({ kind: 'assigned_team' })
  })

  it('returns [] when nothing changed', async () => {
    expect(await getTicketAssignedEmailTargets(assignedEvent(), context)).toEqual([])
  })
})

// ============================================================================
// SLA
// ============================================================================

function slaEvent(type: 'sla.approaching_breach' | 'sla.breached'): EventData {
  return {
    id: 'evt-sla',
    type,
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'service', principalId: 'principal_timer' },
    data: {
      conversationId: 'conversation_1',
      conversation: {
        id: 'conversation_1',
        status: 'open',
        channel: 'email',
        priority: 'none',
        assignedTeamId: null,
      },
      clock: 'first_response',
      dueAt: '2026-07-17T02:00:00Z',
    },
  } as EventData
}

describe('getSlaEmailTargets', () => {
  it('prefers the assigned agent and propagates clock/due labels', async () => {
    queueSelect([
      {
        assignedAgentPrincipalId: 'principal_agent',
        assignedTeamId: null,
        visitorName: 'Jane Doe',
      },
    ])
    queueSelect([{ id: 'principal_agent', email: 'agent@example.com', contactEmail: null }])
    const targets = await getSlaEmailTargets(slaEvent('sla.approaching_breach'), context)
    expect(targets).toHaveLength(1)
    expect(targets[0].config).toMatchObject({
      kind: 'sla_warning',
      title: 'Jane Doe',
      clockLabel: 'first response',
      ctaUrl: 'https://p/admin/inbox?i=conversation_1',
    })
    expect(targets[0].config.dueLabel).toBeTruthy()
  })

  it('falls back to the assigned team roster', async () => {
    queueSelect([{ assignedAgentPrincipalId: null, assignedTeamId: 'team_1', visitorName: null }])
    listTeamMemberPrincipalIds.mockResolvedValue(['principal_member'])
    queueSelect([{ id: 'principal_member', email: 'member@example.com', contactEmail: null }])
    const targets = await getSlaEmailTargets(slaEvent('sla.breached'), context)
    expect(targets).toHaveLength(1)
    expect(targets[0].config).toMatchObject({ kind: 'sla_breach' })
    expect(targets[0].target).toMatchObject({ email: 'member@example.com' })
  })

  it('returns [] when there is neither an assigned agent nor team', async () => {
    queueSelect([{ assignedAgentPrincipalId: null, assignedTeamId: null, visitorName: null }])
    expect(await getSlaEmailTargets(slaEvent('sla.approaching_breach'), context)).toEqual([])
  })
})

describe('customer-type gate on requester-facing emails', () => {
  it('a non-customer ticket yields agent-facing targets only (no portal CTA, no reply-to)', async () => {
    getTicketWatchersForEvent.mockResolvedValue(['principal_requester', 'principal_agent_1'])
    queueSelect([
      { id: 'principal_requester', email: 'req@example.com', contactEmail: null },
      { id: 'principal_agent_1', email: 'agent1@example.com', contactEmail: null },
    ])
    const event = repliedEvent({
      ticket: { ...repliedTicketRef, type: 'back_office' },
    })
    const targets = await getTicketRepliedEmailTargets(event, context)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      const cfg = target.config as { ctaUrl: string; replyTo?: string }
      expect(cfg.ctaUrl).toContain('/admin/inbox')
      expect(cfg.replyTo).toBeUndefined()
    }
  })
})
