/**
 * Registry guard: every integration that has an outbound hook must, when
 * connected, resolve to a delivery target. This is the regression guard for the
 * channelId-resolution bug class (n8n/Make/Zapier/Monday stored their target
 * under a key the resolver never read). A new hook connector with no fixture, or
 * a fixture that resolves to no target, fails this suite.
 *
 * Scope: proves resolution + coverage. It does NOT prove each save path writes
 * its fixture's config — the per-connector save-fn tests do that for the
 * webhook/Monday set.
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

// --- DB mock (mappings come from the cache mock, so the select chain is unused) ---
vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real module (db is a lazy Proxy ⇒ no connection) so transitively
  // imported exports like `ticketSubscriptions` resolve; the explicit overrides
  // below still win for everything this test inspects.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => [] }) }) }),
    query: { webhooks: { findMany: vi.fn().mockResolvedValue([]) } },
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

const { getHookTargets } = await import('../targets')
const { listIntegrationTypes, getIntegrationHook } = await import('@/lib/server/integrations')

/**
 * The config a connected install has, for each hook integration that resolves a
 * delivery target. Slack/Discord store the target in actionConfig.channelId (via
 * addNotificationChannelFn); every other connector stores it in config.channelId.
 *
 * Enrichment hooks that store NO channelId at connect time are listed in
 * KNOWN_UNRESOLVED below, not here — do not fabricate a channelId for them.
 */
const CONNECTED_FIXTURES: Record<
  string,
  { integrationConfig?: Record<string, unknown>; actionConfig?: Record<string, unknown> }
> = {
  slack: { actionConfig: { channelId: 'C1' } },
  discord: { actionConfig: { channelId: 'C1' } },
  teams: { integrationConfig: { channelId: 'C1' } },
  linear: { integrationConfig: { channelId: 'team_1' } },
  jira: { integrationConfig: { channelId: 'PROJ:10001' } },
  github: { integrationConfig: { channelId: 'octo/repo' } },
  gitlab: { integrationConfig: { channelId: '42' } },
  asana: { integrationConfig: { channelId: 'project_1' } },
  clickup: { integrationConfig: { channelId: 'list_1' } },
  shortcut: { integrationConfig: { channelId: 'group_1' } },
  azure_devops: { integrationConfig: { channelId: 'Proj:Bug' } },
  notion: { integrationConfig: { channelId: 'db_1' } },
  trello: { integrationConfig: { channelId: 'list_1' } },
  monday: { integrationConfig: { channelId: '1234567890' } },
  n8n: { integrationConfig: { channelId: 'https://n8n.example.com/webhook/a' } },
  make: { integrationConfig: { channelId: 'https://hook.make.com/a' } },
  zapier: { integrationConfig: { channelId: 'https://hooks.zapier.com/hooks/catch/1/a' } },
  ntfy: { integrationConfig: { channelId: 'https://ntfy.sh/a' } },
}

/**
 * Hook-bearing integrations that do NOT currently resolve a delivery target.
 * These "enrichment" hooks (Stripe/Freshdesk/Salesforce) store no channelId at
 * connect time — their save paths write neither config.channelId nor
 * actionConfig.channelId — so getIntegrationTargets() drops them. This is a
 * separate, known gap (the same bug class, different fix: it needs a
 * resolver-contract change to allow targetless hooks, not just a key rename) and
 * is tracked as a follow-up.
 *
 * Pinned here so (a) the guard never fabricates a passing fixture for a connector
 * that is broken in production, and (b) when one of these is genuinely fixed, the
 * "known-gap" test below trips and forces moving it into CONNECTED_FIXTURES.
 */
const KNOWN_UNRESOLVED = new Set(['stripe', 'freshdesk', 'salesforce'])

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

const hookTypes = listIntegrationTypes().filter((t) => getIntegrationHook(t))
const resolvingTypes = hookTypes.filter((t) => !KNOWN_UNRESOLVED.has(t))

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
})

/** A single enabled post.created mapping row for one integration. */
function mappingRow(
  type: string,
  fixture: { integrationConfig?: Record<string, unknown>; actionConfig?: Record<string, unknown> }
) {
  return {
    eventType: 'post.created',
    integrationType: type,
    secrets: JSON.stringify({ accessToken: 'token' }),
    integrationConfig: fixture.integrationConfig ?? {},
    actionConfig: fixture.actionConfig ?? {},
    filters: null,
  }
}

describe('integration target coverage', () => {
  it('every hook-bearing integration is accounted for (resolving fixture or known gap)', () => {
    expect(hookTypes, 'hookTypes is empty — registry not loaded').not.toHaveLength(0)
    const unaccounted = hookTypes.filter((t) => !CONNECTED_FIXTURES[t] && !KNOWN_UNRESOLVED.has(t))
    expect(
      unaccounted,
      `classify these hook integrations — add a CONNECTED_FIXTURES entry or list in KNOWN_UNRESOLVED: ${unaccounted.join(', ')}`
    ).toEqual([])
  })

  it.each(resolvingTypes)('resolves a delivery target for "%s" when connected', async (type) => {
    mockCacheGet
      .mockResolvedValueOnce([mappingRow(type, CONNECTED_FIXTURES[type] ?? {})]) // INTEGRATION_MAPPINGS
      .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS

    const targets = await getHookTargets(makePostCreatedEvent())
    expect(targets.filter((t) => t.type === type).length).toBeGreaterThan(0)
  })

  // Honest pin of the known gap: these enrichment hooks store no channelId, so
  // they resolve to nothing today. If a fix makes one resolve, this trips and the
  // connector must move into CONNECTED_FIXTURES. See KNOWN_UNRESOLVED above.
  it.each([...KNOWN_UNRESOLVED])(
    'does NOT yet resolve a target for known-gap enrichment hook "%s"',
    async (type) => {
      mockCacheGet
        .mockResolvedValueOnce([mappingRow(type, {})]) // no channelId, as in production
        .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS

      const targets = await getHookTargets(makePostCreatedEvent())
      expect(targets.filter((t) => t.type === type)).toHaveLength(0)
    }
  )
})
