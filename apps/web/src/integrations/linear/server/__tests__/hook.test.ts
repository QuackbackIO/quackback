/**
 * Tests for Linear hook handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostCreatedEvent, EventData } from '@/lib/server/events/types'
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

const target = { channelId: 'team-abc' }
const config = { accessToken: 'lin_test_token', rootUrl: 'https://app.example.com' }

beforeEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('linearHook', () => {
  it('skips non post.created events', async () => {
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
})
