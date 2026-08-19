import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSafeFetch = vi.fn()

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  safeFetch: mockSafeFetch,
}))

vi.mock('../../events/hook-utils', () => ({
  isRetryableError: vi.fn().mockReturnValue(false),
  stripHtml: vi.fn((s: string) => s),
  truncate: vi.fn((s: string) => s),
}))

const { ntfyHook } = await import('@/integrations/ntfy/server/hook')

const ROOT = 'https://app.example.com'

function makeEvent(type = 'post.created') {
  return {
    id: 'evt-1',
    type,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' },
    data: {
      post: {
        id: 'post_1',
        title: 'Test Post',
        content: 'Some content',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
  } as any
}

describe('ntfyHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  it('parses the ntfy URL and POSTs to origin/ with topic in body', async () => {
    const result = await ntfyHook.run(
      makeEvent(),
      { channelId: 'https://ntfy.sh/mytopic' },
      { accessToken: '', rootUrl: ROOT }
    )

    expect(result.success).toBe(true)
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://ntfy.sh/',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"topic":"mytopic"'),
      })
    )
  })

  it('includes Authorization header only when accessToken is set', async () => {
    // With token
    await ntfyHook.run(
      makeEvent(),
      { channelId: 'https://ntfy.sh/mytopic' },
      { accessToken: 'tk_secret', rootUrl: ROOT }
    )
    const headersWithToken = mockSafeFetch.mock.calls[0][1].headers
    expect(headersWithToken['Authorization']).toBe('Bearer tk_secret')

    vi.clearAllMocks()
    mockSafeFetch.mockResolvedValue({ ok: true, status: 200 })

    // Without token (empty string)
    await ntfyHook.run(
      makeEvent(),
      { channelId: 'https://ntfy.sh/mytopic' },
      { accessToken: '', rootUrl: ROOT }
    )
    const headersWithoutToken = mockSafeFetch.mock.calls[0][1].headers
    expect(headersWithoutToken['Authorization']).toBeUndefined()
  })

  it('maps 429 and 500 to shouldRetry:true', async () => {
    for (const status of [429, 500, 503]) {
      mockSafeFetch.mockResolvedValueOnce({ ok: false, status })
      const result = await ntfyHook.run(
        makeEvent(),
        { channelId: 'https://ntfy.sh/mytopic' },
        { accessToken: '', rootUrl: ROOT }
      )
      expect(result.shouldRetry).toBe(true)
    }
  })

  it('maps 400 and 401 to shouldRetry:false', async () => {
    for (const status of [400, 401, 403]) {
      mockSafeFetch.mockResolvedValueOnce({ ok: false, status })
      const result = await ntfyHook.run(
        makeEvent(),
        { channelId: 'https://ntfy.sh/mytopic' },
        { accessToken: '', rootUrl: ROOT }
      )
      expect(result.shouldRetry).toBe(false)
    }
  })

  it('returns success:false shouldRetry:false for an invalid URL', async () => {
    const result = await ntfyHook.run(
      makeEvent(),
      { channelId: 'not-a-url' },
      { accessToken: '', rootUrl: ROOT }
    )
    expect(result.success).toBe(false)
    expect(result.shouldRetry).toBe(false)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })

  it('returns success:true for an unhandled event type (null payload)', async () => {
    const result = await ntfyHook.run(
      makeEvent('post.deleted'),
      { channelId: 'https://ntfy.sh/mytopic' },
      { accessToken: '', rootUrl: ROOT }
    )
    expect(result.success).toBe(true)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })
})
