import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData, PostCreatedEvent } from '../../../events/types'

const onConflictDoUpdateMock = vi.fn()
const insertValuesMock = vi.fn(() => ({
  onConflictDoUpdate: onConflictDoUpdateMock,
  onConflictDoNothing: vi.fn(),
}))
const insertMock = vi.fn((_table: unknown) => ({ values: insertValuesMock }))
const updateWhereMock = vi.fn()
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }))
const updateMock = vi.fn((_table: unknown) => ({ set: updateSetMock }))
const findFirstTicketLinkMock = vi.fn()
const findFirstThreadLinkMock = vi.fn()
const findFirstThreadMock = vi.fn()
const findFirstPrincipalMock = vi.fn()
const findFirstInboxMock = vi.fn()
const findFirstTicketMock = vi.fn()
const selectWhereMock = vi.fn()
const selectInnerJoinMock = vi.fn((..._args: unknown[]) => ({
  where: (...args: unknown[]) => selectWhereMock(...args),
}))
const selectFromMock = vi.fn((..._args: unknown[]) => ({
  innerJoin: (...args: unknown[]) => selectInnerJoinMock(...args),
  where: (...args: unknown[]) => selectWhereMock(...args),
}))
const selectMock = vi.fn((..._args: unknown[]) => ({
  from: (...args: unknown[]) => selectFromMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (table: unknown) => insertMock(table),
    update: (table: unknown) => updateMock(table),
    select: (...args: unknown[]) => selectMock(...args),
    query: {
      ticketExternalLinks: { findFirst: (...args: unknown[]) => findFirstTicketLinkMock(...args) },
      ticketThreadExternalLinks: {
        findFirst: (...args: unknown[]) => findFirstThreadLinkMock(...args),
      },
      ticketThreads: { findFirst: (...args: unknown[]) => findFirstThreadMock(...args) },
      tickets: { findFirst: (...args: unknown[]) => findFirstTicketMock(...args) },
      principal: { findFirst: (...args: unknown[]) => findFirstPrincipalMock(...args) },
      inboxes: { findFirst: (...args: unknown[]) => findFirstInboxMock(...args) },
    },
  },
  integrationSyncLog: {},
  integrations: { id: 'id', errorCount: 'errorCount' },
  ticketExternalLinks: {
    ticketId: 'ticketId',
    integrationId: 'integrationId',
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
  ticketThreads: { id: 'id', ticketId: 'ticketId', audience: 'audience' },
  ticketAttachments: {
    id: 'id',
    threadId: 'threadId',
    filename: 'filename',
    mimeType: 'mimeType',
    sizeBytes: 'sizeBytes',
    publicUrl: 'publicUrl',
  },
  tickets: { id: 'id' },
  ticketStatuses: { category: 'category', deletedAt: 'deletedAt' },
  principal: { id: 'id' },
  inboxes: { id: 'id' },
  integrationUserMappings: {
    integrationId: 'integrationId',
    principalId: 'principalId',
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

import { githubHook } from '../hook'

const originalFetch = globalThis.fetch

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })
}

function setFetch(fetchMock: ReturnType<typeof vi.fn>) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function makePostCreatedEvent(): PostCreatedEvent {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_1' },
    data: {
      post: {
        id: 'post_1',
        title: 'Search is slow',
        content: '<p>Search takes several seconds.</p>',
        boardId: 'board_1',
        boardSlug: 'feedback',
        voteCount: 3,
      },
    },
  }
}

const target = { channelId: 'org/repo' }
const config = {
  accessToken: 'gh_test_token',
  rootUrl: 'https://app.example.com',
  integrationId: 'integration_gh1',
  syncDirection: 'outbound',
}

function makeThreadEvent(
  type: 'ticket.thread_added' | 'ticket.thread_updated' | 'ticket.thread_deleted',
  audience: 'public' | 'internal' | 'shared_team' = 'public'
): EventData {
  const base = {
    id: `evt-${type}`,
    type,
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'service', principalId: 'principal_agent1' },
    data: {
      ticket: {
        id: 'ticket_1',
        subject: 'Login issue',
        descriptionText: null,
        statusId: null,
        statusCategory: null,
        priority: 'normal',
        channel: 'portal',
        visibility: 'team',
        inboxId: 'inbox_support',
        primaryTeamId: null,
        assigneePrincipalId: null,
        assigneeTeamId: null,
        requesterPrincipalId: 'principal_customer1',
        requesterContactId: null,
      },
      threadId: 'ticket_thread_1',
      audience,
      sharedWithTeamId: null,
    },
  }

  if (type === 'ticket.thread_deleted') {
    return {
      ...base,
      data: { ...base.data, deletedByPrincipalId: 'principal_agent1' },
    } as EventData
  }

  return {
    ...base,
    data: {
      ...base.data,
      thread: {
        id: 'ticket_thread_1',
        audience,
        bodyTextPreview: 'Full body preview',
        bodyTextTruncated: false,
        authorPrincipalId: 'principal_agent1',
        isFromRequester: false,
        sharedWithTeamId: null,
        createdAt: '2026-06-12T00:00:00Z',
        ...(type === 'ticket.thread_updated' ? { editedAt: '2026-06-12T00:01:00Z' } : {}),
      },
    },
  } as EventData
}

function makeTicketCreatedEvent(): EventData {
  return {
    id: 'evt-ticket-created',
    type: 'ticket.created',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'service', principalId: 'principal_customer1' },
    data: {
      ticket: {
        id: 'ticket_1',
        subject: 'Login issue',
        descriptionText: 'Cannot log in from the portal.',
        statusId: null,
        statusCategory: 'open',
        priority: 'normal',
        channel: 'portal',
        visibility: 'team',
        inboxId: 'inbox_support',
        primaryTeamId: null,
        assigneePrincipalId: null,
        assigneeTeamId: null,
        requesterPrincipalId: 'principal_customer1',
        requesterContactId: null,
      },
    },
  } as EventData
}

function makeTicketUpdatedEvent(
  overrides: {
    changedFields?: string[]
    diff?: Record<string, { from: unknown; to: unknown }>
    ticket?: Partial<NonNullable<Extract<EventData, { type: 'ticket.updated' }>['data']['ticket']>>
  } = {}
): EventData {
  return {
    id: 'evt-ticket-updated',
    type: 'ticket.updated',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_agent1' },
    data: {
      ticket: {
        id: 'ticket_1',
        subject: 'Updated login issue',
        descriptionText: 'The portal description changed.',
        statusId: null,
        statusCategory: 'open',
        priority: 'urgent',
        channel: 'portal',
        visibility: 'team',
        inboxId: 'inbox_support',
        primaryTeamId: null,
        assigneePrincipalId: null,
        assigneeTeamId: null,
        requesterPrincipalId: 'principal_customer1',
        requesterContactId: null,
        ...overrides.ticket,
      },
      changedFields: overrides.changedFields ?? ['descriptionText'],
      diff: overrides.diff ?? {},
    },
  } as EventData
}

function makeTicketAttachmentEvent(
  type: 'ticket.attachment_added' | 'ticket.attachment_removed'
): EventData {
  return {
    id: `evt-${type}`,
    type,
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_agent1' },
    data:
      type === 'ticket.attachment_added'
        ? {
            ticket: {
              id: 'ticket_1',
              subject: 'Login issue',
              descriptionText: null,
              statusId: null,
              statusCategory: 'open',
              priority: 'normal',
              channel: 'portal',
              visibility: 'team',
              inboxId: 'inbox_support',
              primaryTeamId: null,
              assigneePrincipalId: null,
              assigneeTeamId: null,
              requesterPrincipalId: 'principal_customer1',
              requesterContactId: null,
            },
            attachment: {
              id: 'att_1',
              threadId: 'ticket_thread_1',
              filename: 'screenshot.png',
              mimeType: 'image/png',
              sizeBytes: 2048,
              uploadedByPrincipalId: 'principal_agent1',
              publicUrl: 'https://cdn.example.test/screenshot.png',
            },
          }
        : {
            ticket: {
              id: 'ticket_1',
              subject: 'Login issue',
              descriptionText: null,
              statusId: null,
              statusCategory: 'open',
              priority: 'normal',
              channel: 'portal',
              visibility: 'team',
              inboxId: 'inbox_support',
              primaryTeamId: null,
              assigneePrincipalId: null,
              assigneeTeamId: null,
              requesterPrincipalId: 'principal_customer1',
              requesterContactId: null,
            },
            attachment: {
              id: 'att_1',
              threadId: 'ticket_thread_1',
              filename: 'screenshot.png',
            },
            removedByPrincipalId: 'principal_agent1',
          },
  } as EventData
}

describe('githubHook sync logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    findFirstInboxMock.mockResolvedValue(null)
    findFirstTicketLinkMock.mockResolvedValue({ externalId: '42' })
    findFirstThreadLinkMock.mockResolvedValue(null)
    findFirstThreadMock.mockResolvedValue({
      id: 'ticket_thread_1',
      ticketId: 'ticket_1',
      principalId: 'principal_agent1',
      audience: 'public',
      bodyText: 'Full synced thread body',
      createdAt: new Date('2026-06-12T00:00:00Z'),
      editedAt: null,
      deletedAt: null,
    })
    findFirstPrincipalMock.mockResolvedValue({
      displayName: 'Ada Agent',
      user: { name: 'Ada Agent', email: 'ada@example.com' },
    })
    findFirstTicketMock.mockResolvedValue({ descriptionJson: null, descriptionText: null })
    selectWhereMock.mockResolvedValue([])
  })

  it('logs successful post issue syncs', async () => {
    setFetch(
      mockFetch(201, {
        number: 42,
        html_url: 'https://github.com/org/repo/issues/42',
      })
    )

    const result = await githubHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({
      success: true,
      externalId: '42',
      externalUrl: 'https://github.com/org/repo/issues/42',
    })
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'integration_gh1',
        ticketId: null,
        externalId: '42',
        eventType: 'post.created',
        direction: 'outbound',
        status: 'success',
        errorMessage: null,
        durationMs: expect.any(Number),
      })
    )
  })

  it('logs failed post issue syncs', async () => {
    setFetch(mockFetch(401, { message: 'Bad credentials' }))

    const result = await githubHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({
      success: false,
      error: 'Authentication failed. Please reconnect GitHub.',
      shouldRetry: false,
    })
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'integration_gh1',
        ticketId: null,
        externalId: null,
        eventType: 'post.created',
        direction: 'outbound',
        status: 'failed',
        errorMessage: 'Authentication failed. Please reconnect GitHub.',
        durationMs: expect.any(Number),
      })
    )
  })

  it('does not log non-GitHub events', async () => {
    const result = await githubHook.run(
      { type: 'post.status_changed' } as unknown as EventData,
      target,
      config
    )

    expect(result).toEqual({ success: true })
    expect(insertValuesMock).not.toHaveBeenCalled()
  })
})

describe('githubHook ticket issue creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    findFirstInboxMock.mockResolvedValue({ slug: 'support' })
  })

  it('adds the configured inbox slug as a GitHub issue label', async () => {
    const fetchMock = mockFetch(201, {
      number: 42,
      html_url: 'https://github.com/org/repo/issues/42',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(makeTicketCreatedEvent(), target, {
      ...config,
      defaultInboxId: 'inbox_support',
    })

    expect(result).toEqual({
      success: true,
      externalId: '42',
      externalDisplayId: '#42',
      externalUrl: 'https://github.com/org/repo/issues/42',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues',
      expect.objectContaining({ method: 'POST' })
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      title: 'Login issue',
      labels: ['priority:normal', 'channel:portal', 'support'],
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).body).toContain(
      '<!-- quackback:ticket-issue ticketId=ticket_1 integrationId=integration_gh1 -->'
    )
  })
})

describe('githubHook ticket update sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    findFirstTicketLinkMock.mockResolvedValue({ externalId: '42' })
    findFirstInboxMock.mockResolvedValue(null)
  })

  it('patches the linked GitHub issue when the ticket description changes', async () => {
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)

    const result = await githubHook.run(makeTicketUpdatedEvent(), target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42',
      expect.objectContaining({ method: 'PATCH', body: expect.any(String) })
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      title: 'Updated login issue',
      body: expect.stringContaining('The portal description changed.'),
    })
  })

  it('syncs priority changes as GitHub priority labels', async () => {
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)

    const result = await githubHook.run(
      makeTicketUpdatedEvent({
        changedFields: ['priority'],
        diff: { priority: { from: 'high', to: 'urgent' } },
      }),
      target,
      config
    )

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42/labels/priority%3Ahigh',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42/labels',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ labels: ['priority:urgent'] }),
      })
    )
  })

  it('skips update sync when the ticket has no linked GitHub issue', async () => {
    findFirstTicketLinkMock.mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
    setFetch(fetchMock)

    const result = await githubHook.run(makeTicketUpdatedEvent(), target, config)

    expect(result).toEqual({ success: true, skipped: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('githubHook ticket comment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    findFirstInboxMock.mockResolvedValue(null)
    findFirstTicketLinkMock.mockResolvedValue({ externalId: '42' })
    findFirstThreadLinkMock.mockResolvedValue(null)
    findFirstThreadMock.mockResolvedValue({
      id: 'ticket_thread_1',
      ticketId: 'ticket_1',
      principalId: 'principal_agent1',
      audience: 'public',
      bodyText: 'Full synced thread body',
      createdAt: new Date('2026-06-12T00:00:00Z'),
      editedAt: null,
      deletedAt: null,
    })
    findFirstPrincipalMock.mockResolvedValue({
      displayName: 'Ada Agent',
      user: { name: 'Ada Agent', email: 'ada@example.com' },
    })
  })

  it('creates one GitHub comment and link row for a public thread', async () => {
    const fetchMock = mockFetch(201, {
      id: 1001,
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-1001',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(makeThreadEvent('ticket.thread_added'), target, config)

    expect(result).toEqual({
      success: true,
      externalId: '1001',
      externalUrl: 'https://github.com/org/repo/issues/42#issuecomment-1001',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42/comments',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Full synced thread body'),
      })
    )
    expect(fetchMock.mock.calls[0][1].body).toContain(
      '<!-- quackback:ticket-thread ticketId=ticket_1 threadId=ticket_thread_1 integrationId=integration_gh1 -->'
    )
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket_1',
        threadId: 'ticket_thread_1',
        integrationType: 'github',
        externalIssueId: '42',
        externalCommentId: '1001',
        syncDirection: 'outbound',
      })
    )
  })

  it('skips internal and shared-team threads', async () => {
    const fetchMock = vi.fn()
    setFetch(fetchMock)

    const internalResult = await githubHook.run(
      makeThreadEvent('ticket.thread_added', 'internal'),
      target,
      config
    )
    const sharedResult = await githubHook.run(
      makeThreadEvent('ticket.thread_added', 'shared_team'),
      target,
      config
    )

    expect(internalResult).toEqual({ success: true, skipped: true })
    expect(sharedResult).toEqual({ success: true, skipped: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('patches the linked GitHub comment when a public thread is edited', async () => {
    findFirstThreadLinkMock.mockResolvedValueOnce({
      ticketId: 'ticket_1',
      threadId: 'ticket_thread_1',
      externalIssueId: '42',
      externalCommentId: '1001',
      status: 'active',
    })
    const fetchMock = mockFetch(200, {
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-1001',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(makeThreadEvent('ticket.thread_updated'), target, config)

    expect(result).toEqual({
      success: true,
      externalId: '1001',
      externalUrl: 'https://github.com/org/repo/issues/42#issuecomment-1001',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/comments/1001',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('Full synced thread body'),
      })
    )
  })

  it('deletes the linked GitHub comment when a public thread is deleted', async () => {
    findFirstThreadLinkMock.mockResolvedValueOnce({
      ticketId: 'ticket_1',
      threadId: 'ticket_thread_1',
      externalIssueId: '42',
      externalCommentId: '1001',
      status: 'active',
    })
    const fetchMock = mockFetch(204, {})
    setFetch(fetchMock)

    const result = await githubHook.run(makeThreadEvent('ticket.thread_deleted'), target, config)

    expect(result).toEqual({ success: true, externalId: '1001' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/comments/1001',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deleted', lastSyncedAt: expect.any(Date) })
    )
  })

  it('skips public threads when the ticket has no linked GitHub issue', async () => {
    findFirstTicketLinkMock.mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
    setFetch(fetchMock)

    const result = await githubHook.run(makeThreadEvent('ticket.thread_added'), target, config)

    expect(result).toEqual({ success: true, skipped: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('githubHook ticket attachment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
    findFirstTicketLinkMock.mockResolvedValue({ externalId: '42' })
  })

  it('posts an attachment-added comment to the linked GitHub issue', async () => {
    const fetchMock = mockFetch(201, {
      id: 2024,
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-2024',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(
      makeTicketAttachmentEvent('ticket.attachment_added'),
      target,
      config
    )

    expect(result).toEqual({
      success: true,
      externalId: '2024',
      externalUrl: 'https://github.com/org/repo/issues/42#issuecomment-2024',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42/comments',
      expect.objectContaining({ method: 'POST', body: expect.any(String) })
    )
    const body = fetchMock.mock.calls[0][1].body as string
    expect(body).toContain('screenshot.png')
    expect(body).toContain('![screenshot.png](https://cdn.example.test/screenshot.png)')
    expect(body).toContain(
      '<!-- quackback:ticket-system integrationId=integration_gh1 event=ticket.attachment_added:att_1 -->'
    )
  })

  it('posts an attachment-removed comment to the linked GitHub issue', async () => {
    const fetchMock = mockFetch(201, {
      id: 2025,
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-2025',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(
      makeTicketAttachmentEvent('ticket.attachment_removed'),
      target,
      config
    )

    expect(result).toEqual({
      success: true,
      externalId: '2025',
      externalUrl: 'https://github.com/org/repo/issues/42#issuecomment-2025',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42/comments',
      expect.objectContaining({ method: 'POST', body: expect.any(String) })
    )
    expect(fetchMock.mock.calls[0][1].body as string).toContain('Removed file: **screenshot.png**')
  })
})
