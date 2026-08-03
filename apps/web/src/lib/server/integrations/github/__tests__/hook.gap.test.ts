/**
 * Differential-coverage tests for github hook.ts:
 * - handleGitHubError branches (404 / 422 / 429 / passthrough)
 * - handleTicketStatusChanged (state patch + label, skip paths)
 * - handleTicketAssigned + findGitHubUsername
 * - githubCommentError (comment handler throw path)
 * - renderThreadBodyForGitHub with bodyJson (tiptap markdown)
 * - buildAttachmentBlock (attachments rendered into the thread comment body)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData } from '../../../events/types'

const h = vi.hoisted(() => ({
  insertValuesMock: vi.fn(() => ({ onConflictDoUpdate: vi.fn(), onConflictDoNothing: vi.fn() })),
  updateWhereMock: vi.fn(),
  findFirstTicketLinkMock: vi.fn(),
  findFirstThreadLinkMock: vi.fn(),
  findFirstThreadMock: vi.fn(),
  findFirstPrincipalMock: vi.fn(),
  findFirstInboxMock: vi.fn(),
  findFirstTicketMock: vi.fn(),
  findFirstUserMappingMock: vi.fn(),
  selectWhereMock: vi.fn(),
  tiptapMock: vi.fn(),
}))

const updateSetMock = vi.fn(() => ({ where: h.updateWhereMock }))
const insertMock = vi.fn((_t: unknown) => ({ values: h.insertValuesMock }))
const updateMock = vi.fn((_t: unknown) => ({ set: updateSetMock }))
const selectInnerJoinMock = vi.fn((..._a: unknown[]) => ({
  where: h.selectWhereMock,
}))
const selectFromMock = vi.fn((..._a: unknown[]) => ({
  innerJoin: selectInnerJoinMock,
  where: h.selectWhereMock,
}))
const selectMock = vi.fn((..._a: unknown[]) => ({ from: selectFromMock }))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (t: unknown) => insertMock(t),
    update: (t: unknown) => updateMock(t),
    select: selectMock,
    query: {
      ticketExternalLinks: { findFirst: h.findFirstTicketLinkMock },
      ticketThreadExternalLinks: {
        findFirst: h.findFirstThreadLinkMock,
      },
      ticketThreads: { findFirst: h.findFirstThreadMock },
      tickets: { findFirst: h.findFirstTicketMock },
      principal: { findFirst: h.findFirstPrincipalMock },
      inboxes: { findFirst: h.findFirstInboxMock },
      integrationUserMappings: {
        findFirst: h.findFirstUserMappingMock,
      },
    },
  },
  integrationSyncLog: {},
  integrations: { id: 'id', errorCount: 'errorCount' },
  ticketExternalLinks: { ticketId: 'ticketId', integrationId: 'integrationId', status: 'status' },
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
  principal: { id: 'id' },
  inboxes: { id: 'id' },
  integrationUserMappings: { integrationId: 'integrationId', principalId: 'principalId' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  tiptapJsonToMarkdown: h.tiptapMock,
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
function setFetch(m: ReturnType<typeof vi.fn>) {
  globalThis.fetch = m as unknown as typeof fetch
}

const target = { channelId: 'org/repo' }
const config = {
  accessToken: 'gh_test_token',
  rootUrl: 'https://app.example.com',
  integrationId: 'integration_gh1',
  syncDirection: 'outbound' as const,
}

function makePostCreatedEvent(): EventData {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_1' },
    data: {
      post: {
        id: 'post_1',
        title: 'Search is slow',
        content: '<p>slow</p>',
        boardId: 'board_1',
        boardSlug: 'feedback',
        voteCount: 3,
      },
    },
  } as EventData
}

function makeStatusChangedEvent(newStatusCategory: string): EventData {
  return {
    id: 'evt-status',
    type: 'ticket.status_changed',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_agent1' },
    data: {
      ticket: { id: 'ticket_1', subject: 'x' },
      newStatusCategory,
      oldStatusCategory: 'open',
    },
  } as unknown as EventData
}

function makeAssignedEvent(newAssigneePrincipalId: string | null): EventData {
  return {
    id: 'evt-assigned',
    type: 'ticket.assigned',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_agent1' },
    data: {
      ticket: { id: 'ticket_1', subject: 'x' },
      newAssigneePrincipalId,
      oldAssigneePrincipalId: null,
    },
  } as unknown as EventData
}

function makeThreadAddedEvent(): EventData {
  return {
    id: 'evt-thread',
    type: 'ticket.thread_added',
    timestamp: '2026-06-12T00:00:00Z',
    actor: { type: 'service', principalId: 'principal_agent1' },
    data: {
      ticket: { id: 'ticket_1', subject: 'x', inboxId: 'inbox_support' },
      threadId: 'ticket_thread_1',
      audience: 'public',
      sharedWithTeamId: null,
      thread: {
        id: 'ticket_thread_1',
        audience: 'public',
        isFromRequester: false,
        authorPrincipalId: 'principal_agent1',
        createdAt: '2026-06-12T00:00:00Z',
      },
    },
  } as unknown as EventData
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = originalFetch
  h.findFirstTicketLinkMock.mockResolvedValue({ externalId: '42' })
  h.findFirstThreadLinkMock.mockResolvedValue(null)
  h.findFirstInboxMock.mockResolvedValue(null)
  h.findFirstUserMappingMock.mockResolvedValue(null)
  h.selectWhereMock.mockResolvedValue([])
  h.findFirstPrincipalMock.mockResolvedValue({ displayName: 'Ada Agent', user: null })
})

describe('handleGitHubError branches', () => {
  it('maps 404 to a non-retryable repo-not-found error', async () => {
    setFetch(mockFetch(404, 'not found'))
    const result = await githubHook.run(makePostCreatedEvent(), target, config)
    expect(result).toEqual({
      success: false,
      error: 'Repository "org/repo" not found or not accessible.',
      shouldRetry: false,
    })
  })

  it('maps 422 to a non-retryable validation error including the body', async () => {
    setFetch(mockFetch(422, 'bad title'))
    const result = await githubHook.run(makePostCreatedEvent(), target, config)
    expect(result).toEqual({
      success: false,
      error: 'Validation error: bad title',
      shouldRetry: false,
    })
  })

  it('maps 429 to a retryable rate-limit error', async () => {
    setFetch(mockFetch(429, 'slow down'))
    const result = await githubHook.run(makePostCreatedEvent(), target, config)
    expect(result).toEqual({
      success: false,
      error: 'Rate limited by GitHub API.',
      shouldRetry: true,
    })
  })

  it('falls through to a thrown HTTP error for unmapped statuses (e.g. 500)', async () => {
    setFetch(mockFetch(500, 'server error'))
    const result = await githubHook.run(makePostCreatedEvent(), target, config)
    expect(result).toMatchObject({ success: false, error: 'HTTP 500' })
  })
})

describe('handleTicketStatusChanged', () => {
  it('patches the issue to closed with a completed reason', async () => {
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)

    const result = await githubHook.run(makeStatusChangedEvent('closed'), target, config)

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42',
      expect.objectContaining({ method: 'PATCH' })
    )
    const patchCall = fetchMock.mock.calls.find((c) => c[1].method === 'PATCH')
    expect(JSON.parse(patchCall![1].body as string)).toMatchObject({
      state: 'closed',
      state_reason: 'completed',
    })
  })

  it('patches the issue state and adds the mapped label (pending -> waiting-on-customer)', async () => {
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)

    const result = await githubHook.run(makeStatusChangedEvent('pending'), target, config)

    expect(result).toEqual({ success: true })
    const patchCall = fetchMock.mock.calls.find((c) => c[1].method === 'PATCH')
    expect(JSON.parse(patchCall![1].body as string)).toMatchObject({ state: 'open' })
    expect(JSON.parse(patchCall![1].body as string).state_reason).toBeUndefined()
    // best-effort label POST
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/issues/42/labels',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ labels: ['waiting-on-customer'] }),
      })
    )
  })

  it('skips when there is no linked issue', async () => {
    h.findFirstTicketLinkMock.mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
    setFetch(fetchMock)
    const result = await githubHook.run(makeStatusChangedEvent('closed'), target, config)
    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when the status category has no mapping', async () => {
    const fetchMock = vi.fn()
    setFetch(fetchMock)
    const result = await githubHook.run(makeStatusChangedEvent('nonexistent_cat'), target, config)
    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a failed retryable result when the PATCH throws unmapped error', async () => {
    setFetch(mockFetch(500, 'boom'))
    const result = await githubHook.run(makeStatusChangedEvent('closed'), target, config)
    expect(result).toMatchObject({ success: false, error: 'HTTP 500' })
  })
})

describe('handleTicketAssigned + findGitHubUsername', () => {
  const assignConfig = { ...config, assigneeSync: true }

  it('skips when assigneeSync is disabled', async () => {
    const fetchMock = vi.fn()
    setFetch(fetchMock)
    const result = await githubHook.run(makeAssignedEvent('principal_agent1'), target, config)
    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when there is no linked issue', async () => {
    h.findFirstTicketLinkMock.mockResolvedValueOnce(null)
    const fetchMock = vi.fn()
    setFetch(fetchMock)
    const result = await githubHook.run(makeAssignedEvent('principal_agent1'), target, assignConfig)
    expect(result).toEqual({ success: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves the GitHub username and patches the issue assignees', async () => {
    h.findFirstUserMappingMock.mockResolvedValueOnce({ externalUsername: 'octocat' })
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)

    const result = await githubHook.run(makeAssignedEvent('principal_agent1'), target, assignConfig)

    expect(result).toEqual({ success: true })
    const patchCall = fetchMock.mock.calls.find((c) => c[1].method === 'PATCH')
    expect(JSON.parse(patchCall![1].body as string)).toEqual({ assignees: ['octocat'] })
  })

  it('patches with empty assignees when there is no mapped username', async () => {
    h.findFirstUserMappingMock.mockResolvedValueOnce(null)
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)

    const result = await githubHook.run(makeAssignedEvent('principal_agent1'), target, assignConfig)

    expect(result).toEqual({ success: true })
    const patchCall = fetchMock.mock.calls.find((c) => c[1].method === 'PATCH')
    expect(JSON.parse(patchCall![1].body as string)).toEqual({ assignees: [] })
  })

  it('patches with empty assignees on unassignment (null principal)', async () => {
    const fetchMock = mockFetch(200, {})
    setFetch(fetchMock)
    const result = await githubHook.run(makeAssignedEvent(null), target, assignConfig)
    expect(result).toEqual({ success: true })
    const patchCall = fetchMock.mock.calls.find((c) => c[1].method === 'PATCH')
    expect(JSON.parse(patchCall![1].body as string)).toEqual({ assignees: [] })
  })

  it('returns a failed result when the assignee PATCH fails (401)', async () => {
    setFetch(mockFetch(401, 'bad creds'))
    const result = await githubHook.run(makeAssignedEvent('principal_agent1'), target, assignConfig)
    expect(result).toEqual({
      success: false,
      error: 'Authentication failed. Please reconnect GitHub.',
      shouldRetry: false,
    })
  })
})

describe('thread comment body rendering (tiptap + attachments)', () => {
  it('renders bodyJson via tiptap and appends an attachment block, then githubCommentError on failure', async () => {
    h.findFirstThreadMock.mockResolvedValue({
      id: 'ticket_thread_1',
      ticketId: 'ticket_1',
      principalId: 'principal_agent1',
      audience: 'public',
      bodyJson: { type: 'doc', content: [] },
      bodyText: 'fallback text',
      createdAt: new Date('2026-06-12T00:00:00Z'),
      editedAt: null,
      deletedAt: null,
    })
    h.tiptapMock.mockReturnValue('Rendered **markdown** body')
    // thread attachments query returns one image attachment
    h.selectWhereMock.mockResolvedValue([
      {
        id: 'att_1',
        threadId: 'ticket_thread_1',
        filename: 'pic.png',
        mimeType: 'image/png',
        sizeBytes: 4096,
        publicUrl: 'https://cdn.example.test/pic.png',
      },
    ])

    const fetchMock = mockFetch(201, {
      id: 1001,
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-1001',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(makeThreadAddedEvent(), target, config)

    expect(result).toMatchObject({ success: true, externalId: '1001' })
    const body = fetchMock.mock.calls[0][1].body as string
    expect(body).toContain('Rendered **markdown** body')
    expect(body).toContain('### Thread attachments')
    expect(body).toContain('![pic.png](https://cdn.example.test/pic.png)')
    expect(h.tiptapMock).toHaveBeenCalled()
  })

  it('falls back to bodyText when tiptap rendering throws', async () => {
    h.findFirstThreadMock.mockResolvedValue({
      id: 'ticket_thread_1',
      ticketId: 'ticket_1',
      principalId: 'principal_agent1',
      audience: 'public',
      bodyJson: { type: 'doc' },
      bodyText: 'plain fallback body',
      createdAt: new Date('2026-06-12T00:00:00Z'),
      editedAt: null,
      deletedAt: null,
    })
    h.tiptapMock.mockImplementation(() => {
      throw new Error('render failed')
    })
    const fetchMock = mockFetch(201, {
      id: 1002,
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-1002',
    })
    setFetch(fetchMock)

    const result = await githubHook.run(makeThreadAddedEvent(), target, config)

    expect(result).toMatchObject({ success: true })
    expect(fetchMock.mock.calls[0][1].body as string).toContain('plain fallback body')
  })

  it('returns githubCommentError when comment creation fails', async () => {
    h.findFirstThreadMock.mockResolvedValue({
      id: 'ticket_thread_1',
      ticketId: 'ticket_1',
      principalId: 'principal_agent1',
      audience: 'public',
      bodyJson: null,
      bodyText: 'body',
      createdAt: new Date('2026-06-12T00:00:00Z'),
      editedAt: null,
      deletedAt: null,
    })
    setFetch(mockFetch(500, 'comment failure'))

    const result = await githubHook.run(makeThreadAddedEvent(), target, config)

    expect(result).toMatchObject({ success: false })
    expect(result.success).toBe(false)
  })
})
