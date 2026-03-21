/**
 * Slack channel cache tests.
 *
 * Verifies the migration to shared cache helpers (cacheGet/cacheSet/CACHE_KEYS).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Redis cache mocks ---
const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  CACHE_KEYS: {
    SLACK_CHANNELS: 'slack:channels',
  },
}))

// --- Slack WebClient mock ---
const mockConversationsList = vi.fn()
const mockConversationsJoin = vi.fn()

vi.mock('@slack/web-api', () => ({
  WebClient: class MockWebClient {
    conversations = {
      list: mockConversationsList,
      join: mockConversationsJoin,
    }
  },
}))

const { listSlackChannels } = await import('../channels')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
})

describe('listSlackChannels', () => {
  it('returns cached channels on cache hit', async () => {
    const cached = [
      { id: 'C1', name: 'general', isPrivate: false },
      { id: 'C2', name: 'random', isPrivate: false },
    ]
    mockCacheGet.mockResolvedValue(cached)

    const result = await listSlackChannels('xoxb-token')

    expect(result).toEqual(cached)
    expect(mockCacheGet).toHaveBeenCalledWith('slack:channels')
    expect(mockConversationsList).not.toHaveBeenCalled()
  })

  it('fetches from Slack API and caches on miss', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockConversationsList.mockResolvedValue({
      ok: true,
      channels: [
        { id: 'C1', name: 'general', is_private: false },
        { id: 'C2', name: 'random', is_private: false },
      ],
      response_metadata: { next_cursor: '' },
    })

    const result = await listSlackChannels('xoxb-token')

    expect(result).toHaveLength(2)
    expect(mockConversationsList).toHaveBeenCalled()
    expect(mockCacheSet).toHaveBeenCalledWith(
      'slack:channels',
      expect.arrayContaining([expect.objectContaining({ id: 'C1', name: 'general' })]),
      300
    )
  })

  it('bypasses cache when force=true', async () => {
    const cached = [{ id: 'C1', name: 'old', isPrivate: false }]
    mockCacheGet.mockResolvedValue(cached)
    mockConversationsList.mockResolvedValue({
      ok: true,
      channels: [{ id: 'C1', name: 'updated', is_private: false }],
      response_metadata: { next_cursor: '' },
    })

    const result = await listSlackChannels('xoxb-token', { force: true })

    // Should NOT have checked cache
    expect(mockCacheGet).not.toHaveBeenCalled()
    // Should have fetched from API
    expect(mockConversationsList).toHaveBeenCalled()
    expect(result[0].name).toBe('updated')
  })

  it('skips ext_shared channels', async () => {
    mockConversationsList.mockResolvedValue({
      ok: true,
      channels: [
        { id: 'C1', name: 'general', is_private: false },
        { id: 'C2', name: 'ext-partner', is_private: false, is_ext_shared: true },
      ],
      response_metadata: { next_cursor: '' },
    })

    const result = await listSlackChannels('xoxb-token')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('general')
  })
})
