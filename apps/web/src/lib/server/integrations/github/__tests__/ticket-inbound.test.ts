/**
 * Unit tests for ticket-inbound.ts — GitHub issue → Quackback ticket sync.
 *
 * Verifies: event routing, ticket creation, status transitions, assignment
 * mapping, and loop-prevention via syncSourceIntegrationId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mocks ----

const createTicketMock = vi.fn()
const getTicketMock = vi.fn()
const transitionStatusMock = vi.fn()
const updateTicketMock = vi.fn()
const assignTicketMock = vi.fn()

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: (...a: unknown[]) => createTicketMock(...a),
  getTicket: (...a: unknown[]) => getTicketMock(...a),
  transitionStatus: (...a: unknown[]) => transitionStatusMock(...a),
  updateTicket: (...a: unknown[]) => updateTicketMock(...a),
  assignTicket: (...a: unknown[]) => assignTicketMock(...a),
}))

const insertMock = vi
  .fn()
  .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() }) })
const updateMock = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) })
const findFirstLinkMock = vi.fn()
const findFirstStatusMock = vi.fn()
const findFirstMappingMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...a: unknown[]) => insertMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
    query: {
      ticketExternalLinks: { findFirst: (...a: unknown[]) => findFirstLinkMock(...a) },
      ticketStatuses: { findFirst: (...a: unknown[]) => findFirstStatusMock(...a) },
      integrationUserMappings: { findFirst: (...a: unknown[]) => findFirstMappingMock(...a) },
    },
  },
  ticketExternalLinks: {
    integrationId: 'integrationId',
    externalId: 'externalId',
    status: 'status',
  },
  ticketStatuses: { category: 'category', deletedAt: 'deletedAt' },
  integrationUserMappings: { integrationId: 'integrationId', externalUsername: 'externalUsername' },
  integrationSyncLog: {},
  integrations: { errorCount: 'errorCount' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

import { handleGitHubTicketEvent, type GitHubIssuePayload } from '../ticket-inbound'

// ---- Fixtures ----

const NOW = new Date('2026-06-11T00:00:00Z')

function makeIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'integration_gh1',
    principalId: 'principal_bot1',
    config: {
      channelId: 'org/repo',
      syncDirection: 'bidirectional' as const,
      createTicketsFromIssues: true,
      assigneeSync: true,
      defaultInboxId: 'inbox_support',
      ...overrides,
    },
  }
}

function makePayload(
  action: string,
  overrides: Partial<GitHubIssuePayload['issue']> = {}
): GitHubIssuePayload {
  return {
    action,
    issue: {
      number: 42,
      title: 'Bug: login fails on mobile',
      body: 'Steps to reproduce...',
      html_url: 'https://github.com/org/repo/issues/42',
      state: action === 'closed' ? 'closed' : 'open',
      state_reason: action === 'closed' ? 'completed' : null,
      assignee: null,
      assignees: [],
      labels: [],
      ...overrides,
    },
    repository: { full_name: 'org/repo' },
    sender: { login: 'octocat' },
  }
}

// ---- Setup ----

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no linked ticket found (for create path)
  findFirstLinkMock.mockResolvedValue(null)
  findFirstStatusMock.mockResolvedValue(null)
  findFirstMappingMock.mockResolvedValue(null)
})

// ---- Tests ----

describe('handleGitHubTicketEvent — routing', () => {
  it('returns false when syncDirection is outbound-only', async () => {
    const result = await handleGitHubTicketEvent(
      makePayload('opened'),
      makeIntegration({ syncDirection: 'outbound' })
    )
    expect(result).toBe(false)
    expect(createTicketMock).not.toHaveBeenCalled()
  })

  it('returns false for unknown actions', async () => {
    const result = await handleGitHubTicketEvent(makePayload('pinned'), makeIntegration())
    expect(result).toBe(false)
  })
})

describe('handleGitHubTicketEvent — issues.opened', () => {
  it('creates ticket with correct fields and syncSourceIntegrationId', async () => {
    createTicketMock.mockResolvedValueOnce({ id: 'ticket_new1' })

    const result = await handleGitHubTicketEvent(makePayload('opened'), makeIntegration())

    expect(result).toBe(true)
    expect(createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Bug: login fails on mobile',
        descriptionText: 'Steps to reproduce...',
        channel: 'api',
        inboxId: 'inbox_support',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })

  it('skips when createTicketsFromIssues is false', async () => {
    const result = await handleGitHubTicketEvent(
      makePayload('opened'),
      makeIntegration({ createTicketsFromIssues: false })
    )
    expect(result).toBe(false)
    expect(createTicketMock).not.toHaveBeenCalled()
  })

  it('inserts external link after ticket creation', async () => {
    createTicketMock.mockResolvedValueOnce({ id: 'ticket_new1' })
    const insertValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() })
    insertMock.mockReturnValueOnce({ values: insertValuesMock })

    await handleGitHubTicketEvent(makePayload('opened'), makeIntegration())

    expect(insertMock).toHaveBeenCalled()
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket_new1',
        integrationType: 'github',
        externalId: '42',
        externalDisplayId: '#42',
        syncDirection: 'inbound',
      })
    )
  })
})

describe('handleGitHubTicketEvent — issues.closed', () => {
  it('transitions linked ticket to solved status', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstStatusMock.mockResolvedValueOnce({ id: 'tstatus_solved' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    transitionStatusMock.mockResolvedValueOnce({})

    const result = await handleGitHubTicketEvent(makePayload('closed'), makeIntegration())

    expect(result).toBe(true)
    expect(transitionStatusMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        statusId: 'tstatus_solved',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })

  it('does nothing when issue is not linked to a ticket', async () => {
    findFirstLinkMock.mockResolvedValueOnce(null)

    const result = await handleGitHubTicketEvent(makePayload('closed'), makeIntegration())

    expect(result).toBe(true) // handler ran but no-op'd
    expect(transitionStatusMock).not.toHaveBeenCalled()
  })
})

describe('handleGitHubTicketEvent — issues.reopened', () => {
  it('transitions linked ticket back to open status', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstStatusMock.mockResolvedValueOnce({ id: 'tstatus_open' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    transitionStatusMock.mockResolvedValueOnce({})

    const result = await handleGitHubTicketEvent(makePayload('reopened'), makeIntegration())

    expect(result).toBe(true)
    expect(transitionStatusMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        statusId: 'tstatus_open',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })
})

describe('handleGitHubTicketEvent — issues.edited', () => {
  it('updates ticket subject and description', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    updateTicketMock.mockResolvedValueOnce({})

    const payload = makePayload('edited', { title: 'Updated title', body: 'New body' })
    const result = await handleGitHubTicketEvent(payload, makeIntegration())

    expect(result).toBe(true)
    expect(updateTicketMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        subject: 'Updated title',
        descriptionText: 'New body',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })
})

describe('handleGitHubTicketEvent — issues.assigned', () => {
  it('assigns ticket to mapped principal', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstMappingMock.mockResolvedValueOnce({ principalId: 'principal_dev1' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    assignTicketMock.mockResolvedValueOnce({})

    const payload = makePayload('assigned', { assignee: { login: 'dev-user' } })
    const result = await handleGitHubTicketEvent(payload, makeIntegration())

    expect(result).toBe(true)
    expect(assignTicketMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        assigneePrincipalId: 'principal_dev1',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })

  it('skips when assigneeSync is disabled', async () => {
    const result = await handleGitHubTicketEvent(
      makePayload('assigned', { assignee: { login: 'dev-user' } }),
      makeIntegration({ assigneeSync: false })
    )
    expect(result).toBe(false)
    expect(assignTicketMock).not.toHaveBeenCalled()
  })

  it('skips when no user mapping exists for the GitHub username', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstMappingMock.mockResolvedValueOnce(null)

    const payload = makePayload('assigned', { assignee: { login: 'unknown-user' } })
    const result = await handleGitHubTicketEvent(payload, makeIntegration())

    expect(result).toBe(true) // handled but skipped assignment
    expect(assignTicketMock).not.toHaveBeenCalled()
  })
})

describe('handleGitHubTicketEvent — issues.unassigned', () => {
  it('clears ticket assignment', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    getTicketMock.mockResolvedValueOnce({
      id: 'ticket_linked1',
      updatedAt: NOW,
      assigneePrincipalId: 'principal_prev',
    })
    assignTicketMock.mockResolvedValueOnce({})

    const result = await handleGitHubTicketEvent(makePayload('unassigned'), makeIntegration())

    expect(result).toBe(true)
    expect(assignTicketMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        assigneePrincipalId: null,
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })

  it('skips when ticket has no current assignee', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    getTicketMock.mockResolvedValueOnce({
      id: 'ticket_linked1',
      updatedAt: NOW,
      assigneePrincipalId: null,
    })

    const result = await handleGitHubTicketEvent(makePayload('unassigned'), makeIntegration())

    expect(result).toBe(true)
    expect(assignTicketMock).not.toHaveBeenCalled()
  })
})

describe('syncSourceIntegrationId — loop prevention', () => {
  it('every service call passes integration.id as syncSourceIntegrationId', async () => {
    // Create
    createTicketMock.mockResolvedValueOnce({ id: 'ticket_new1' })
    await handleGitHubTicketEvent(makePayload('opened'), makeIntegration())
    expect(createTicketMock.mock.calls[0][0].syncSourceIntegrationId).toBe('integration_gh1')

    // Transition (close)
    vi.clearAllMocks()
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstStatusMock.mockResolvedValueOnce({ id: 'tstatus_solved' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    transitionStatusMock.mockResolvedValueOnce({})
    await handleGitHubTicketEvent(makePayload('closed'), makeIntegration())
    expect(transitionStatusMock.mock.calls[0][1].syncSourceIntegrationId).toBe('integration_gh1')

    // Edit
    vi.clearAllMocks()
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    updateTicketMock.mockResolvedValueOnce({})
    await handleGitHubTicketEvent(makePayload('edited'), makeIntegration())
    expect(updateTicketMock.mock.calls[0][1].syncSourceIntegrationId).toBe('integration_gh1')
  })
})
