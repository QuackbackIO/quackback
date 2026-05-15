/**
 * Event targets resolution for `post.mentioned`.
 *
 * Verifies:
 * - Happy path: a real principal with an email gets ONE notification target
 *   AND ONE email target
 * - Missing principal: no notification or email targets are produced
 * - Principal without email: notification target appears, email target does not
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
//
// getMentionTargets selects from `principal` left-joined to `user`. We mock
// the select() chain so we can return whatever rows the test wants.
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockLeftJoin = vi.fn()
const mockDbWhere = vi.fn()
const mockLimit = vi.fn()
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
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
    role: 'principal.role',
    type: 'principal.type',
    displayName: 'principal.displayName',
  },
  user: {
    id: 'user.id',
    email: 'user.email',
  },
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  or: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
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
    workspaceName: 'Test Workspace',
    portalBaseUrl: 'https://test.quackback.io',
    logoUrl: 'https://test.quackback.io/logo.png',
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
  // Default: no integration mappings, no webhooks
  mockCacheGet
    .mockResolvedValueOnce([]) // INTEGRATION_MAPPINGS
    .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS
})

/**
 * Wire up the select chain so it returns `rows` for the mention query.
 * The mention query is select().from(principal).leftJoin(user).where(eq).limit(1)
 */
function setupMentionDbChain(rows: unknown[]) {
  mockLimit.mockResolvedValue(rows)
  mockDbWhere.mockReturnValue({ limit: mockLimit })
  mockLeftJoin.mockReturnValue({ where: mockDbWhere })
  mockFrom.mockReturnValue({ leftJoin: mockLeftJoin })
  mockSelect.mockReturnValue({ from: mockFrom })
}

function makePostMentionedEvent() {
  return {
    id: 'evt-1',
    type: 'post.mentioned' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const, userId: 'user_actor', email: 'actor@test.com' },
    data: {
      postId: 'post_1',
      postTitle: 'A test post',
      postUrl: 'https://test.quackback.io/b/bugs/posts/post_1',
      mentionedPrincipalId: 'principal_mentioned',
      mentioningPrincipalId: 'principal_actor',
      excerpt: 'Hey @alice, what do you think?',
    },
  }
}

describe('post.mentioned target resolution', () => {
  it('returns one notification target and one email target when principal has email', async () => {
    setupMentionDbChain([
      {
        id: 'principal_mentioned',
        type: 'user',
        role: 'user',
        email: 'alice@example.com',
      },
    ])

    const targets = await getHookTargets(makePostMentionedEvent())

    const notificationTargets = targets.filter((t) => t.type === 'notification')
    const emailTargets = targets.filter((t) => t.type === 'email')

    expect(notificationTargets).toHaveLength(1)
    expect(notificationTargets[0].target).toEqual({
      principalIds: ['principal_mentioned'],
    })

    expect(emailTargets).toHaveLength(1)
    expect(emailTargets[0].target).toMatchObject({
      email: 'alice@example.com',
    })
    expect(emailTargets[0].config).toMatchObject({
      postTitle: 'A test post',
      postUrl: 'https://test.quackback.io/b/bugs/posts/post_1',
      workspaceName: 'Test Workspace',
    })
  })

  it('returns no notification or email targets when the principal does not exist', async () => {
    setupMentionDbChain([]) // principal lookup returns nothing

    const targets = await getHookTargets(makePostMentionedEvent())

    const notificationTargets = targets.filter((t) => t.type === 'notification')
    const emailTargets = targets.filter((t) => t.type === 'email')

    expect(notificationTargets).toHaveLength(0)
    expect(emailTargets).toHaveLength(0)
  })

  it('returns notification target but no email target when principal has no email', async () => {
    setupMentionDbChain([
      {
        id: 'principal_mentioned',
        type: 'user',
        role: 'user',
        email: null, // user with no email
      },
    ])

    const targets = await getHookTargets(makePostMentionedEvent())

    const notificationTargets = targets.filter((t) => t.type === 'notification')
    const emailTargets = targets.filter((t) => t.type === 'email')

    expect(notificationTargets).toHaveLength(1)
    expect(notificationTargets[0].target).toEqual({
      principalIds: ['principal_mentioned'],
    })

    expect(emailTargets).toHaveLength(0)
  })
})
