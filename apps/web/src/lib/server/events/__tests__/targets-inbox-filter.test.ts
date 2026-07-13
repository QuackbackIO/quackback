/**
 * Phase 4: per-inbox webhook filter tests for `getHookTargets`.
 *
 * Verifies the new `inboxIds` filter behaves like the existing `boardIds`
 * filter for ticket events. Uses the same mock surface as
 * `targets-cache.test.ts` so the two suites stay close in style.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockInnerJoin = vi.fn()
const mockDbWhere = vi.fn()
const mockFindMany = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real module (db is a lazy Proxy ⇒ no connection) so transitively
  // imported exports like `ticketSubscriptions` resolve; the explicit overrides
  // below still win for everything this test inspects.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      webhooks: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    },
  },
  integrations: {},
  integrationEventMappings: {},
  webhooks: { status: 'status', deletedAt: 'deletedAt', $inferSelect: {} },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  principal: {},
}))

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
// Out of scope for this suite: ticket *email* targets are a separate concern
// (own DB queries). Left unmocked, getTicketEmailTargets runs for every
// ticket.* event and throws on the unmocked DB, which getHookTargets swallows
// into an empty result — silently zeroing the webhook/integration targets this
// suite asserts on. Stub it to [] so we isolate inbox-filter behaviour.
vi.mock('../ticket-targets', () => ({
  getTicketEmailTargets: vi.fn().mockResolvedValue([]),
}))

const { getHookTargets } = await import('../targets')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
  mockDbWhere.mockResolvedValue([])
  mockInnerJoin.mockReturnValue({ where: mockDbWhere })
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin })
  mockSelect.mockReturnValue({ from: mockFrom })
})

function makeTicketCreatedEvent(inboxId: string | null) {
  return {
    id: 'evt-tkt-1',
    type: 'ticket.created' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const, userId: 'user_1', email: 't@t.com' },
    data: {
      ticket: {
        id: 'ticket_1',
        subject: 'help',
        descriptionText: null,
        statusId: 'tstatus_open',
        statusCategory: 'open',
        priority: 'normal',
        channel: 'portal',
        visibility: 'team',
        inboxId,
        primaryTeamId: null,
        assigneePrincipalId: null,
        assigneeTeamId: null,
        requesterPrincipalId: null,
        requesterContactId: null,
      },
    },
  }
}

function makePostCreatedEvent() {
  return {
    id: 'evt-post-1',
    type: 'post.created' as const,
    timestamp: '2025-01-01T00:00:00Z',
    actor: { type: 'user' as const, userId: 'user_1', email: 't@t.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'T',
        content: 'C',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
  }
}

function setActiveWebhooks(rows: unknown[]) {
  // Key the cache by its actual key rather than call order — getHookTargets
  // issues several cacheGet calls (integration mappings, then webhooks) and the
  // intermediate ordering is not stable, so an ordered mockResolvedValueOnce
  // queue mis-assigns the webhook rows. '[]' for every other key is a safe
  // empty cache hit (avoids unmocked DB fallbacks).
  mockCacheGet.mockImplementation((key: string) =>
    Promise.resolve(key === 'hooks:webhooks-active' ? rows : [])
  )
}

function setActiveIntegrationMappings(rows: unknown[]) {
  mockCacheGet.mockImplementation((key: string) =>
    Promise.resolve(key === 'hooks:integration-mappings' ? rows : [])
  )
}

function makeGitHubTicketMapping(filters: { inboxIds?: string[] } | null) {
  return {
    integrationId: 'integration_1',
    eventType: 'ticket.created',
    integrationType: 'github',
    secrets: JSON.stringify({ accessToken: 'ghs_test' }),
    integrationConfig: {
      channelId: 'quackback/repo',
      syncDirection: 'outbound',
    },
    actionConfig: {},
    filters,
  }
}

describe('getHookTargets — inbox filter (Phase 4)', () => {
  it('matches a ticket event when inboxIds includes the event inbox', async () => {
    setActiveWebhooks([
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'sec',
        events: ['ticket.created'],
        boardIds: null,
        inboxIds: ['inbox_1'],
        status: 'active',
      },
    ])
    const targets = await getHookTargets(makeTicketCreatedEvent('inbox_1'))
    expect(targets.filter((t) => t.type === 'webhook')).toHaveLength(1)
  })

  it('excludes a ticket event when inboxIds does not include the event inbox', async () => {
    setActiveWebhooks([
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'sec',
        events: ['ticket.created'],
        boardIds: null,
        inboxIds: ['inbox_2'],
        status: 'active',
      },
    ])
    const targets = await getHookTargets(makeTicketCreatedEvent('inbox_1'))
    expect(targets.filter((t) => t.type === 'webhook')).toHaveLength(0)
  })

  it('matches any ticket event when inboxIds is null (backwards compat)', async () => {
    setActiveWebhooks([
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'sec',
        events: ['ticket.created'],
        boardIds: null,
        inboxIds: null,
        status: 'active',
      },
    ])
    const targets = await getHookTargets(makeTicketCreatedEvent('inbox_anything'))
    expect(targets.filter((t) => t.type === 'webhook')).toHaveLength(1)
  })

  it('does NOT constrain non-ticket events', async () => {
    setActiveWebhooks([
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'sec',
        events: ['post.created'],
        boardIds: null,
        // Inbox filter is set but the event is post.created — must still match.
        inboxIds: ['inbox_1'],
        status: 'active',
      },
    ])
    const targets = await getHookTargets(makePostCreatedEvent())
    expect(targets.filter((t) => t.type === 'webhook')).toHaveLength(1)
  })

  it('excludes ticket events with null inboxId from inbox-filtered webhooks (opt-in)', async () => {
    setActiveWebhooks([
      {
        id: 'wh_1',
        url: 'https://example.com/hook',
        secret: 'sec',
        events: ['ticket.created'],
        boardIds: null,
        inboxIds: ['inbox_1'],
        status: 'active',
      },
    ])
    const targets = await getHookTargets(makeTicketCreatedEvent(null))
    expect(targets.filter((t) => t.type === 'webhook')).toHaveLength(0)
  })

  it('matches a ticket integration mapping when inboxIds includes the event inbox', async () => {
    setActiveIntegrationMappings([makeGitHubTicketMapping({ inboxIds: ['inbox_1'] })])

    const targets = await getHookTargets(makeTicketCreatedEvent('inbox_1'))

    const githubTargets = targets.filter((t) => t.type === 'github')
    expect(githubTargets).toHaveLength(1)
    expect(githubTargets[0].target).toEqual({ channelId: 'quackback/repo' })
    expect(githubTargets[0].config).toMatchObject({
      accessToken: 'ghs_test',
      integrationId: 'integration_1',
      syncDirection: 'outbound',
    })
  })

  it('excludes a ticket integration mapping when inboxIds does not include the event inbox', async () => {
    setActiveIntegrationMappings([makeGitHubTicketMapping({ inboxIds: ['inbox_2'] })])

    const targets = await getHookTargets(makeTicketCreatedEvent('inbox_1'))

    expect(targets.filter((t) => t.type === 'github')).toHaveLength(0)
  })

  it('excludes ticket events with null inboxId from inbox-filtered integrations', async () => {
    setActiveIntegrationMappings([makeGitHubTicketMapping({ inboxIds: ['inbox_1'] })])

    const targets = await getHookTargets(makeTicketCreatedEvent(null))

    expect(targets.filter((t) => t.type === 'github')).toHaveLength(0)
  })

  it('matches any ticket integration mapping when inboxIds is null', async () => {
    setActiveIntegrationMappings([makeGitHubTicketMapping(null)])

    const targets = await getHookTargets(makeTicketCreatedEvent('inbox_anything'))

    expect(targets.filter((t) => t.type === 'github')).toHaveLength(1)
  })
})
