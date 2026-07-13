/**
 * Differential-coverage tests for github ticket-comments:
 * - listGitHubIssueComments (fetch loop + pagination via parseNextLink, error path)
 * - isUniqueViolation (exercised through upsertThreadExternalLink conflict fallback)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const insertOnConflictMock = vi.fn()
  const insertValuesMock = vi.fn(() => ({ onConflictDoUpdate: insertOnConflictMock }))
  const insertMock = vi.fn((_t: unknown) => ({ values: insertValuesMock }))
  const updateWhereMock = vi.fn()
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }))
  const updateMock = vi.fn((_t: unknown) => ({ set: updateSetMock }))
  return {
    insertOnConflictMock,
    insertValuesMock,
    insertMock,
    updateWhereMock,
    updateSetMock,
    updateMock,
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (t: unknown) => h.insertMock(t),
    update: (t: unknown) => h.updateMock(t),
    query: {},
  },
  ticketThreadExternalLinks: {
    integrationId: 'integrationId',
    threadId: 'threadId',
    externalCommentId: 'externalCommentId',
  },
  eq: vi.fn(),
  and: vi.fn(),
  sql: (s: unknown) => s,
}))

import { listGitHubIssueComments, upsertThreadExternalLink } from '../ticket-comments'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('listGitHubIssueComments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('follows pagination via the link header until no next page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 1, body: 'a' }],
        headers: {
          get: () => '<https://api.github.com/repos/org/repo/issues/5/comments?page=2>; rel="next"',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 2, body: 'b' }],
        headers: { get: () => null },
      })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const comments = await listGitHubIssueComments({
      ownerRepo: 'org/repo',
      issueNumber: '5',
      accessToken: 'tok',
      since: '2026-01-01T00:00:00Z',
    })

    expect(comments).toEqual([
      { id: 1, body: 'a' },
      { id: 2, body: 'b' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // since query param is appended on the first request
    expect(fetchMock.mock.calls[0][0]).toContain('since=')
  })

  it('throws on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
      headers: { get: () => null },
    }) as unknown as typeof fetch

    await expect(
      listGitHubIssueComments({ ownerRepo: 'org/repo', issueNumber: '5', accessToken: 'tok' })
    ).rejects.toThrow('HTTP 500: boom')
  })
})

describe('upsertThreadExternalLink isUniqueViolation fallback', () => {
  beforeEach(() => vi.clearAllMocks())

  const args = {
    ticketId: 'ticket_1',
    threadId: 'thread_1',
    integrationId: 'integration_1',
    externalIssueId: '42',
    externalCommentId: '1001',
    syncDirection: 'outbound' as const,
  }

  it('falls back to an update when the insert hits a unique violation (code 23505)', async () => {
    h.insertOnConflictMock.mockRejectedValueOnce({ code: '23505' })

    await upsertThreadExternalLink(args)

    expect(h.updateSetMock).toHaveBeenCalledTimes(1)
    expect(h.updateWhereMock).toHaveBeenCalledTimes(1)
  })

  it('detects unique violation nested in error.cause', async () => {
    h.insertOnConflictMock.mockRejectedValueOnce({ cause: { code: '23505' } })

    await upsertThreadExternalLink(args)

    expect(h.updateSetMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows errors that are not unique violations', async () => {
    h.insertOnConflictMock.mockRejectedValueOnce(new Error('some other error'))

    await expect(upsertThreadExternalLink(args)).rejects.toThrow('some other error')
    expect(h.updateSetMock).not.toHaveBeenCalled()
  })
})
