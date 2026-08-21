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

vi.mock('@/lib/server/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: vi.fn(),
  CACHE_KEYS: {
    WORKSPACE_SETTINGS: 'settings:workspace',
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

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      webhooks: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
}))

// --- Other mocks ---
vi.mock('@/lib/server/integrations/encryption', () => ({
  decryptSecrets: vi.fn((s: string) => JSON.parse(s)),
}))

vi.mock('@/lib/server/integrations/jira/access-token', () => ({
  getJiraAccessToken: vi.fn(async (integration: { secrets: unknown }) => {
    const parsed = JSON.parse(integration.secrets as string) as { accessToken?: string }
    return parsed.accessToken
  }),
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

// Key-based cacheGet mock. The resolver registry runs sinks CONCURRENTLY, so
// call-order (mockResolvedValueOnce) mocks are non-deterministic; match on the
// cache key instead. `undefined` for a response means "cache miss" (null).
function cacheByKey(opts: { mappings?: unknown; webhooks?: unknown }) {
  mockCacheGet.mockImplementation((key: string) =>
    Promise.resolve(
      key === 'hooks:integration-mappings'
        ? (opts.mappings ?? null)
        : key === 'hooks:webhooks-active'
          ? (opts.webhooks ?? null)
          : null
    )
  )
}

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
    cacheByKey({ mappings: cachedMappings, webhooks: [] })

    const targets = await getHookTargets(makePostCreatedEvent())

    // Should have called cacheGet for integration mappings
    expect(mockCacheGet).toHaveBeenCalledWith('hooks:integration-mappings')
    // Cache hit → the integration mappings were NOT re-queried + re-cached.
    // (Assert on the mappings cache-refresh rather than the generic db.select,
    // which the app-webhook resolver also uses now.)
    expect(mockCacheSet).not.toHaveBeenCalledWith(
      'hooks:integration-mappings',
      expect.anything(),
      expect.anything()
    )
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

    cacheByKey({ mappings: cachedMappings, webhooks: [] })

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

    cacheByKey({ webhooks: [] })

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

describe('integration hook config', () => {
  function mapping(overrides: Record<string, unknown>) {
    return {
      eventType: 'post.created',
      secrets: JSON.stringify({ accessToken: 'tok' }),
      actionConfig: { channelId: 'chan' },
      filters: null,
      ...overrides,
    }
  }

  async function targetsFor(row: Record<string, unknown>) {
    // Key-based mock — sinks resolve concurrently, so Once-order is a race.
    cacheByKey({ mappings: [row], webhooks: [] })
    return getHookTargets(makePostCreatedEvent())
  }

  it('forwards stored integration config and lets accessToken/rootUrl win', async () => {
    const [jira] = (
      await targetsFor(
        mapping({
          integrationType: 'jira',
          integrationConfig: {
            cloudId: 'cloud-1',
            siteUrl: 'https://ex.atlassian.net',
            accessToken: 'stale-from-config',
            rootUrl: 'https://should-not-use',
          },
          actionConfig: { channelId: '10000:10001' },
        })
      )
    ).filter((t) => t.type === 'jira')

    expect(jira.config).toMatchObject({
      cloudId: 'cloud-1',
      siteUrl: 'https://ex.atlassian.net',
      accessToken: 'tok',
      rootUrl: 'https://test.quackback.io',
    })
  })

  it('forwards organizationName, apiKey, and teamId from stored config', async () => {
    cacheByKey({
      mappings: [
        mapping({
          integrationType: 'azure_devops',
          integrationConfig: { organizationName: 'acme' },
          actionConfig: { channelId: 'Proj:Task' },
        }),
        mapping({
          integrationType: 'trello',
          integrationConfig: { apiKey: 'key-1' },
          actionConfig: { channelId: 'list-1' },
        }),
        mapping({
          integrationType: 'teams',
          integrationConfig: { teamId: 'team-1' },
          actionConfig: { channelId: 'ch-1' },
        }),
      ],
      webhooks: [],
    })

    const targets = await getHookTargets(makePostCreatedEvent())
    expect(targets.find((t) => t.type === 'azure_devops')?.config).toMatchObject({
      organizationName: 'acme',
      accessToken: 'tok',
    })
    expect(targets.find((t) => t.type === 'trello')?.config).toMatchObject({ apiKey: 'key-1' })
    expect(targets.find((t) => t.type === 'teams')?.config).toMatchObject({ teamId: 'team-1' })
  })

  it('does not put inbound webhook fields on the hook job', async () => {
    const [jira] = (
      await targetsFor(
        mapping({
          integrationType: 'jira',
          integrationConfig: {
            cloudId: 'cloud-1',
            webhookSecret: 'whsec_should_not_leak',
            statusMappings: { Done: 'status_1' },
            statusSyncEnabled: true,
            externalWebhookId: '99',
          },
          actionConfig: { channelId: '10000:10001' },
        })
      )
    ).filter((t) => t.type === 'jira')

    expect(jira.config).toMatchObject({ cloudId: 'cloud-1', accessToken: 'tok' })
    expect(jira.config).not.toHaveProperty('webhookSecret')
    expect(jira.config).not.toHaveProperty('statusMappings')
    expect(jira.config).not.toHaveProperty('statusSyncEnabled')
    expect(jira.config).not.toHaveProperty('externalWebhookId')
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

    cacheByKey({ mappings: [], webhooks: cachedWebhooks })

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

    cacheByKey({ mappings: [] })

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

    cacheByKey({ mappings: [], webhooks: cachedWebhooks })

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

    cacheByKey({ mappings: [], webhooks: cachedWebhooks })

    setupIntegrationDbChain([])

    const targets = await getHookTargets(makePostCreatedEvent())

    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    expect(webhookTargets).toHaveLength(1)
    expect(webhookTargets[0].target).toEqual({ url: 'https://example.com/hook2' })
  })
})
