/**
 * Event targets caching tests.
 *
 * Verifies:
 * - Integration mappings are fetched from cache when available
 * - Integration mappings are queried from DB and cached on miss
 * - Event type filtering happens in JS after cache hit
 * - Webhook targets are fetched from cache when available
 * - Webhook targets are queried from DB and cached on miss
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Redis cache mocks ---
const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: vi.fn(),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
    INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
    ACTIVE_WEBHOOKS: 'hooks:webhooks-active',
    SLACK_CHANNELS: 'slack:channels',
  },
}))

// --- DB mocks ---
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockInnerJoin = vi.fn()
const mockDbWhere = vi.fn()
const mockFindMany = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      webhooks: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
  integrations: {
    id: 'id',
    integrationType: 'integrationType',
    secrets: 'secrets',
    config: 'config',
    status: 'status',
  },
  integrationEventMappings: {
    integrationId: 'integrationId',
    eventType: 'eventType',
    actionConfig: 'actionConfig',
    filters: 'filters',
    enabled: 'enabled',
  },
  webhooks: {
    status: 'status',
    deletedAt: 'deletedAt',
    $inferSelect: {},
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  principal: {},
}))

// --- Other mocks ---
vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: vi.fn((s: string) => JSON.parse(s)),
}))

vi.mock('@/lib/server/domains/webhooks/encryption', () => ({
  decryptWebhookSecret: vi.fn((s: string) => s),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscribersForEvent: vi.fn().mockResolvedValue([]),
  batchGetNotificationPreferences: vi.fn().mockResolvedValue(new Map()),
  batchGenerateUnsubscribeTokens: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn().mockReturnValue(null),
}))

vi.mock('../hook-context', () => ({
  buildHookContext: vi.fn().mockResolvedValue({
    workspaceName: 'Test',
    portalBaseUrl: 'https://test.quackback.io',
  }),
}))

vi.mock('../hook-utils', () => ({
  stripHtml: vi.fn((s: string) => s),
  truncate: vi.fn((s: string) => s),
}))

// Import after mocks
const { getHookTargets } = await import('../targets')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
})

// Helper: set up the DB chain for integration mappings
function setupIntegrationDbChain(rows: unknown[]) {
  mockDbWhere.mockResolvedValue(rows)
  mockInnerJoin.mockReturnValue({ where: mockDbWhere })
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin })
  mockSelect.mockReturnValue({ from: mockFrom })
}

function makePostCreatedEvent() {
  return {
    id: 'evt-1',
    type: 'post.created' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const, userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Test',
        content: 'Content',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
  }
}

// ============================================================================
// Integration mapping caching
// ============================================================================

describe('integration mapping caching', () => {
  it('uses cached mappings when available', async () => {
    const cachedMappings = [
      {
        eventType: 'post.created',
        integrationType: 'slack',
        secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
        integrationConfig: { channelId: 'C123' },
        actionConfig: { channelId: 'C123' },
        filters: null,
      },
    ]

    // First call returns null (integration mappings), second returns null (webhooks)
    mockCacheGet
      .mockResolvedValueOnce(cachedMappings) // INTEGRATION_MAPPINGS
      .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS

    const targets = await getHookTargets(makePostCreatedEvent())

    // Should have called cacheGet for integration mappings
    expect(mockCacheGet).toHaveBeenCalledWith('hooks:integration-mappings')
    // DB select should NOT have been called (cache hit)
    expect(mockSelect).not.toHaveBeenCalled()
    // Should have a slack target
    const slackTargets = targets.filter((t) => t.type === 'slack')
    expect(slackTargets).toHaveLength(1)
    expect(slackTargets[0].target).toEqual({ channelId: 'C123' })
  })

  it('filters cached mappings by event type', async () => {
    const cachedMappings = [
      {
        eventType: 'post.created',
        integrationType: 'slack',
        secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
        integrationConfig: {},
        actionConfig: { channelId: 'C123' },
        filters: null,
      },
      {
        eventType: 'post.status_changed',
        integrationType: 'slack',
        secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
        integrationConfig: {},
        actionConfig: { channelId: 'C456' },
        filters: null,
      },
    ]

    mockCacheGet
      .mockResolvedValueOnce(cachedMappings) // INTEGRATION_MAPPINGS
      .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS

    const targets = await getHookTargets(makePostCreatedEvent())

    // Only the post.created mapping should produce a target
    const slackTargets = targets.filter((t) => t.type === 'slack')
    expect(slackTargets).toHaveLength(1)
    expect(slackTargets[0].target).toEqual({ channelId: 'C123' })
  })

  it('queries DB and caches on miss', async () => {
    const dbRows = [
      {
        eventType: 'post.created',
        integrationType: 'slack',
        secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
        integrationConfig: {},
        actionConfig: { channelId: 'C789' },
        filters: null,
      },
    ]

    mockCacheGet
      .mockResolvedValueOnce(null) // INTEGRATION_MAPPINGS cache miss
      .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS

    setupIntegrationDbChain(dbRows)

    const targets = await getHookTargets(makePostCreatedEvent())

    // DB was queried
    expect(mockSelect).toHaveBeenCalled()
    // Result was cached
    expect(mockCacheSet).toHaveBeenCalledWith('hooks:integration-mappings', dbRows, 300)
    // Target was returned
    const slackTargets = targets.filter((t) => t.type === 'slack')
    expect(slackTargets).toHaveLength(1)
  })
})

// ============================================================================
// Webhook caching
// ============================================================================

describe('webhook caching', () => {
  it('uses cached webhooks when available', async () => {
    const cachedWebhooks = [
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'encrypted-secret',
        events: ['post.created'],
        boardIds: null,
        status: 'active',
      },
    ]

    mockCacheGet
      .mockResolvedValueOnce([]) // INTEGRATION_MAPPINGS (empty)
      .mockResolvedValueOnce(cachedWebhooks) // ACTIVE_WEBHOOKS

    // No DB setup needed for integration mappings since we return empty cache
    setupIntegrationDbChain([])

    const targets = await getHookTargets(makePostCreatedEvent())

    expect(mockCacheGet).toHaveBeenCalledWith('hooks:webhooks-active')
    // DB findMany should NOT have been called for webhooks (cache hit)
    expect(mockFindMany).not.toHaveBeenCalled()
    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    expect(webhookTargets).toHaveLength(1)
    expect(webhookTargets[0].target).toEqual({ url: 'https://example.com/hook' })
  })

  it('queries DB and caches on miss', async () => {
    const dbWebhooks = [
      {
        id: 'wh_2',
        url: 'https://example.com/hook2',
        secret: 'encrypted-secret-2',
        events: ['post.created'],
        boardIds: null,
        status: 'active',
      },
    ]

    mockCacheGet
      .mockResolvedValueOnce([]) // INTEGRATION_MAPPINGS (empty)
      .mockResolvedValueOnce(null) // ACTIVE_WEBHOOKS cache miss

    setupIntegrationDbChain([])
    mockFindMany.mockResolvedValue(dbWebhooks)

    const targets = await getHookTargets(makePostCreatedEvent())

    // DB was queried
    expect(mockFindMany).toHaveBeenCalled()
    // Result was cached
    expect(mockCacheSet).toHaveBeenCalledWith('hooks:webhooks-active', dbWebhooks, 300)
    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    expect(webhookTargets).toHaveLength(1)
  })

  it('filters cached webhooks by event type', async () => {
    const cachedWebhooks = [
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'secret1',
        events: ['post.created'],
        boardIds: null,
        status: 'active',
      },
      {
        id: 'wh_2',
        url: 'https://example.com/hook2',
        secret: 'secret2',
        events: ['post.status_changed'], // different event type
        boardIds: null,
        status: 'active',
      },
    ]

    mockCacheGet
      .mockResolvedValueOnce([]) // INTEGRATION_MAPPINGS
      .mockResolvedValueOnce(cachedWebhooks) // ACTIVE_WEBHOOKS

    setupIntegrationDbChain([])

    const targets = await getHookTargets(makePostCreatedEvent())

    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    // Only the post.created webhook should match
    expect(webhookTargets).toHaveLength(1)
    expect(webhookTargets[0].target).toEqual({ url: 'https://example.com/hook' })
  })

  it('filters cached webhooks by board', async () => {
    const cachedWebhooks = [
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'secret1',
        events: ['post.created'],
        boardIds: ['board_999'], // non-matching board
        status: 'active',
      },
      {
        id: 'wh_2',
        url: 'https://example.com/hook2',
        secret: 'secret2',
        events: ['post.created'],
        boardIds: ['board_1'], // matching board
        status: 'active',
      },
    ]

    mockCacheGet
      .mockResolvedValueOnce([]) // INTEGRATION_MAPPINGS
      .mockResolvedValueOnce(cachedWebhooks) // ACTIVE_WEBHOOKS

    setupIntegrationDbChain([])

    const targets = await getHookTargets(makePostCreatedEvent())

    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    expect(webhookTargets).toHaveLength(1)
    expect(webhookTargets[0].target).toEqual({ url: 'https://example.com/hook2' })
  })
})
