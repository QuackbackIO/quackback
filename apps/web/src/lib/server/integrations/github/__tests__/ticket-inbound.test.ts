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
const addThreadMock = vi.fn()
const editThreadMock = vi.fn()
const softDeleteThreadMock = vi.fn()
const markdownToTiptapJsonMock = vi.fn((markdown: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }],
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: (...a: [string]) => markdownToTiptapJsonMock(...a),
}))

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: (...a: unknown[]) => createTicketMock(...a),
  getTicket: (...a: unknown[]) => getTicketMock(...a),
  transitionStatus: (...a: unknown[]) => transitionStatusMock(...a),
  updateTicket: (...a: unknown[]) => updateTicketMock(...a),
  assignTicket: (...a: unknown[]) => assignTicketMock(...a),
}))

vi.mock('@/lib/server/domains/tickets/ticket.threads', () => ({
  addThread: (...a: unknown[]) => addThreadMock(...a),
  editThread: (...a: unknown[]) => editThreadMock(...a),
  softDeleteThread: (...a: unknown[]) => softDeleteThreadMock(...a),
}))

const insertValuesMock = vi.fn().mockReturnValue({
  onConflictDoNothing: vi.fn(),
  onConflictDoUpdate: vi.fn(),
})
const insertMock = vi
  .fn()
  .mockReturnValue({ values: (...args: unknown[]) => insertValuesMock(...args) })
const updateMock = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) })
const findFirstLinkMock = vi.fn()
const findFirstThreadLinkMock = vi.fn()
const findFirstThreadMock = vi.fn()
const findFirstStatusMock = vi.fn()
const findFirstMappingMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...a: unknown[]) => insertMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
    query: {
      ticketExternalLinks: { findFirst: (...a: unknown[]) => findFirstLinkMock(...a) },
      ticketThreadExternalLinks: {
        findFirst: (...a: unknown[]) => findFirstThreadLinkMock(...a),
      },
      ticketThreads: { findFirst: (...a: unknown[]) => findFirstThreadMock(...a) },
      ticketStatuses: { findFirst: (...a: unknown[]) => findFirstStatusMock(...a) },
      integrationUserMappings: { findFirst: (...a: unknown[]) => findFirstMappingMock(...a) },
    },
  },
  ticketExternalLinks: {
    integrationId: 'integrationId',
    externalId: 'externalId',
    status: 'status',
  },
  ticketThreadExternalLinks: {
    ticketId: 'ticketId',
    threadId: 'threadId',
    integrationId: 'integrationId',
    externalIssueId: 'externalIssueId',
    externalCommentId: 'externalCommentId',
    externalUrl: 'externalUrl',
    syncDirection: 'syncDirection',
    status: 'status',
    lastSyncedAt: 'lastSyncedAt',
    updatedAt: 'updatedAt',
  },
  ticketThreads: { id: 'id' },
  ticketStatuses: { category: 'category', deletedAt: 'deletedAt' },
  integrationUserMappings: { integrationId: 'integrationId', externalUsername: 'externalUsername' },
  integrationSyncLog: {},
  integrations: { errorCount: 'errorCount' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

import {
  handleGitHubIssueCommentEvent,
  handleGitHubTicketEvent,
  type GitHubIssueCommentPayload,
  type GitHubIssuePayload,
} from '../ticket-inbound'

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

function makeCommentPayload(
  action: string,
  body = 'This is a GitHub comment'
): GitHubIssueCommentPayload {
  return {
    action,
    issue: {
      number: 42,
      html_url: 'https://github.com/org/repo/issues/42',
    },
    comment: {
      id: 1001,
      body,
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-1001',
      user: { login: 'octocat' },
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
  findFirstThreadLinkMock.mockResolvedValue(null)
  findFirstThreadMock.mockResolvedValue(null)
  findFirstStatusMock.mockResolvedValue(null)
  findFirstMappingMock.mockResolvedValue(null)
  addThreadMock.mockResolvedValue({ id: 'ticket_thread_1' })
  editThreadMock.mockResolvedValue({ id: 'ticket_thread_1' })
  softDeleteThreadMock.mockResolvedValue({ id: 'ticket_thread_1' })
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
        descriptionJson: expect.objectContaining({ type: 'doc' }),
        channel: 'api',
        inboxId: 'inbox_support',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
    expect(markdownToTiptapJsonMock).toHaveBeenCalledWith('Steps to reproduce...')
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
        descriptionJson: expect.objectContaining({ type: 'doc' }),
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
    expect(markdownToTiptapJsonMock).toHaveBeenCalledWith('New body')
  })

  it('clears ticket description when the GitHub issue body is empty', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    getTicketMock.mockResolvedValueOnce({
      id: 'ticket_linked1',
      updatedAt: NOW,
      descriptionJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old body' }] }],
      },
      descriptionText: 'Old body',
    })
    updateTicketMock.mockResolvedValueOnce({})

    const payload = makePayload('edited', { body: null })
    const result = await handleGitHubTicketEvent(payload, makeIntegration())

    expect(result).toBe(true)
    expect(updateTicketMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        descriptionJson: null,
        descriptionText: null,
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })

  it('strips Quackback metadata from outbound GitHub issue bodies', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    getTicketMock.mockResolvedValueOnce({ id: 'ticket_linked1', updatedAt: NOW })
    updateTicketMock.mockResolvedValueOnce({})

    const payload = makePayload('edited', {
      body: [
        'Updated customer-facing description',
        '',
        '---',
        '',
        '**Priority:** high',
        '**Channel:** portal',
        '',
        '[View in Quackback](https://example.test/admin/tickets/ticket_linked1)',
      ].join('\n'),
    })
    const result = await handleGitHubTicketEvent(payload, makeIntegration())

    expect(result).toBe(true)
    expect(updateTicketMock).toHaveBeenCalledWith(
      'ticket_linked1',
      expect.objectContaining({
        descriptionText: 'Updated customer-facing description',
        descriptionJson: expect.objectContaining({ type: 'doc' }),
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
    expect(markdownToTiptapJsonMock).toHaveBeenCalledWith('Updated customer-facing description')
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

describe('handleGitHubIssueCommentEvent', () => {
  it('creates a public ticket thread and link row on issue_comment.created', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstThreadLinkMock.mockResolvedValueOnce(null)
    addThreadMock.mockResolvedValueOnce({ id: 'ticket_thread_1' })

    const result = await handleGitHubIssueCommentEvent(
      makeCommentPayload('created'),
      makeIntegration()
    )

    expect(result).toBe(true)
    expect(addThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket_linked1',
        audience: 'public',
        bodyText: 'GitHub reply from octocat:\n\nThis is a GitHub comment',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket_linked1',
        threadId: 'ticket_thread_1',
        integrationType: 'github',
        externalIssueId: '42',
        externalCommentId: '1001',
        syncDirection: 'inbound',
      })
    )
  })

  it('is idempotent when issue_comment.created is retried', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstThreadLinkMock.mockResolvedValueOnce({
      ticketId: 'ticket_linked1',
      threadId: 'ticket_thread_1',
      externalIssueId: '42',
      externalCommentId: '1001',
      status: 'active',
    })

    const result = await handleGitHubIssueCommentEvent(
      makeCommentPayload('created'),
      makeIntegration()
    )

    expect(result).toBe(true)
    expect(addThreadMock).not.toHaveBeenCalled()
  })

  it('updates the linked ticket thread on issue_comment.edited', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstThreadLinkMock.mockResolvedValueOnce({
      ticketId: 'ticket_linked1',
      threadId: 'ticket_thread_1',
      externalIssueId: '42',
      externalCommentId: '1001',
      status: 'active',
    })
    findFirstThreadMock.mockResolvedValueOnce({
      id: 'ticket_thread_1',
      principalId: 'principal_bot1',
      deletedAt: null,
    })

    const result = await handleGitHubIssueCommentEvent(
      makeCommentPayload('edited', 'Edited GitHub body'),
      makeIntegration()
    )

    expect(result).toBe(true)
    expect(editThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'ticket_thread_1',
        actorPrincipalId: 'principal_bot1',
        bodyText: 'GitHub reply from octocat:\n\nEdited GitHub body',
        syncSourceIntegrationId: 'integration_gh1',
      })
    )
  })

  it('soft-deletes the linked ticket thread on issue_comment.deleted', async () => {
    findFirstLinkMock.mockResolvedValueOnce({ ticketId: 'ticket_linked1' })
    findFirstThreadLinkMock.mockResolvedValueOnce({
      ticketId: 'ticket_linked1',
      threadId: 'ticket_thread_1',
      externalIssueId: '42',
      externalCommentId: '1001',
      status: 'active',
    })

    const result = await handleGitHubIssueCommentEvent(
      makeCommentPayload('deleted'),
      makeIntegration()
    )

    expect(result).toBe(true)
    expect(softDeleteThreadMock).toHaveBeenCalledWith(
      'ticket_thread_1',
      'principal_bot1',
      'integration_gh1'
    )
  })

  it('skips Quackback-marker comments to prevent echo', async () => {
    const marker =
      '<!-- quackback:ticket-thread ticketId=ticket_linked1 threadId=ticket_thread_1 integrationId=integration_gh1 -->'

    const result = await handleGitHubIssueCommentEvent(
      makeCommentPayload('created', `Outbound reply\n\n${marker}`),
      makeIntegration()
    )

    expect(result).toBe(true)
    expect(addThreadMock).not.toHaveBeenCalled()
    expect(editThreadMock).not.toHaveBeenCalled()
    expect(softDeleteThreadMock).not.toHaveBeenCalled()
  })
})
