/**
 * Tests for Linear hook handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostCreatedEvent, CommentCreatedEvent, EventData } from '@/lib/server/events/types'

const findLink = vi.hoisted(() => vi.fn())
const findPendingCreate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      postExternalLinks: { findFirst: findLink },
      integrationSyncOperations: { findFirst: findPendingCreate },
    },
  },
}))

import { linearHook } from '@/integrations/linear/server/hook'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function makePostCreatedEvent(overrides: Record<string, unknown> = {}): PostCreatedEvent {
  return {
    id: 'evt-1',
    type: 'post.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Bug report',
        content: '<p>Something broke</p>',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 3,
        ...overrides,
      },
    },
  }
}

function makeCommentCreatedEvent(overrides: Record<string, unknown> = {}): CommentCreatedEvent {
  return {
    id: 'evt-2',
    type: 'comment.created',
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_2', email: 'sam@example.com' },
    data: {
      comment: {
        id: 'comment_1',
        content: 'Happens on Safari too',
        authorName: 'Sam Lee',
        isPrivate: false,
        ...overrides,
      },
      post: { id: 'post_1', title: 'Bug report', boardId: 'board_1', boardSlug: 'bugs' },
    },
  }
}

const target = { channelId: 'team-abc' }
const config = {
  accessToken: 'lin_test_token',
  rootUrl: 'https://app.example.com',
  integrationId: 'integration_1',
}

beforeEach(() => {
  vi.restoreAllMocks()
  findLink.mockReset()
  findPendingCreate.mockReset()
  findPendingCreate.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('linearHook', () => {
  it('skips events it does not sync', async () => {
    const event = { type: 'post.status_changed' } as unknown as EventData
    const result = await linearHook.run(event, target, config)
    expect(result).toEqual({ state: 'succeeded' })
  })

  it('returns externalId (UUID) and externalDisplayId (identifier) on success', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'uuid-abc-123',
              identifier: 'QUA-42',
              url: 'https://linear.app/quackback/issue/QUA-42/bug-report',
            },
          },
        },
      })
    )

    const result = await linearHook.run(makePostCreatedEvent(), target, config)

    expect(result.state).toBe('succeeded')
    if (result.state !== 'succeeded') throw new Error('Expected successful delivery')
    expect(result.result?.externalId).toBe('uuid-abc-123')
    expect(result.result?.externalDisplayId).toBe('QUA-42')
    expect(result.result?.externalUrl).toBe('https://linear.app/quackback/issue/QUA-42/bug-report')
  })

  it('sends correct GraphQL mutation with team ID', async () => {
    const fetchMock = mockFetch(200, {
      data: {
        issueCreate: {
          success: true,
          issue: { id: 'id', identifier: 'QUA-1', url: 'https://linear.app/issue' },
        },
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    await linearHook.run(makePostCreatedEvent(), target, config)

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://api.linear.app/graphql')
    const body = JSON.parse(call[1].body)
    expect(body.variables.input.teamId).toBe('team-abc')
    expect(body.variables.input.title).toBe('Bug report')
    expect(body.query).toContain('issueCreate')
    expect(body.query).toContain('identifier')
  })

  it('returns failure on GraphQL errors', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { errors: [{ message: 'Team not found' }] }))

    const result = await linearHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ state: 'uncertain', errorCode: 'outcome_unknown' })
  })

  it('returns failure when no issue is returned', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, { data: { issueCreate: { success: true, issue: null } } })
    )

    const result = await linearHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ state: 'uncertain', errorCode: 'outcome_unknown' })
  })

  it('returns non-retryable failure on 401', async () => {
    vi.stubGlobal('fetch', mockFetch(401))

    const result = await linearHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ state: 'auth_required', errorCode: 'authentication' })
  })

  it('returns retryable failure on 429', async () => {
    vi.stubGlobal('fetch', mockFetch(429))

    const result = await linearHook.run(makePostCreatedEvent(), target, config)

    expect(result).toEqual({ state: 'retry_wait', errorCode: 'unavailable' })
  })

  describe('comment.created', () => {
    it('adds the public comment to the linked Linear issue', async () => {
      findLink.mockResolvedValue({ externalId: 'uuid-issue-1' })
      const fetchMock = mockFetch(200, {
        data: { commentCreate: { success: true, comment: { id: 'uuid-comment-9' } } },
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await linearHook.run(makeCommentCreatedEvent(), target, config)

      expect(result).toEqual({ state: 'succeeded', result: { externalId: 'uuid-comment-9' } })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.query).toContain('commentCreate')
      expect(body.variables.input.issueId).toBe('uuid-issue-1')
      expect(body.variables.input.body).toContain('**Sam Lee commented:**')
      expect(body.variables.input.body).toContain('Happens on Safari too')
      expect(body.variables.input.body).toContain(
        'https://app.example.com/b/bugs/posts/post_1#comment-comment_1'
      )
    })

    it('does nothing when the post has no linked Linear issue', async () => {
      findLink.mockResolvedValue(undefined)
      const fetchMock = mockFetch(200, {})
      vi.stubGlobal('fetch', fetchMock)

      const result = await linearHook.run(makeCommentCreatedEvent(), target, config)

      expect(result).toEqual({ state: 'succeeded' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('waits for the issue when its creation is still in flight for this post', async () => {
      findLink.mockResolvedValue(undefined)
      findPendingCreate.mockResolvedValue({ id: 'op_1', state: 'queued' })
      const fetchMock = mockFetch(200, {})
      vi.stubGlobal('fetch', fetchMock)

      const result = await linearHook.run(makeCommentCreatedEvent(), target, config)

      expect(result).toEqual({
        state: 'retry_wait',
        errorCode: 'unavailable',
        retryAfterMs: expect.any(Number),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns auth_required when Linear rejects the token', async () => {
      findLink.mockResolvedValue({ externalId: 'uuid-issue-1' })
      vi.stubGlobal('fetch', mockFetch(401))

      const result = await linearHook.run(makeCommentCreatedEvent(), target, config)

      expect(result).toEqual({ state: 'auth_required', errorCode: 'authentication' })
    })

    it('returns retry_wait when Linear rate-limits the request', async () => {
      findLink.mockResolvedValue({ externalId: 'uuid-issue-1' })
      vi.stubGlobal('fetch', mockFetch(429))

      const result = await linearHook.run(makeCommentCreatedEvent(), target, config)

      expect(result).toEqual({ state: 'retry_wait', errorCode: 'unavailable' })
    })

    it('reports an unknown outcome when the mutation does not confirm the comment', async () => {
      findLink.mockResolvedValue({ externalId: 'uuid-issue-1' })
      vi.stubGlobal(
        'fetch',
        mockFetch(200, { data: { commentCreate: { success: false, comment: null } } })
      )

      const result = await linearHook.run(makeCommentCreatedEvent(), target, config)

      expect(result).toEqual({ state: 'uncertain', errorCode: 'outcome_unknown' })
    })
  })
})
