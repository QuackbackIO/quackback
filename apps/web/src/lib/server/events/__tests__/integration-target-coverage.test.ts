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
vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => [] }) }) }),
    query: { webhooks: { findMany: vi.fn().mockResolvedValue([]) } },
  },
  integrations: { id: 'id', integrationType: 'integrationType', secrets: 'secrets', config: 'config', status: 'status' },
  integrationEventMappings: { integrationId: 'integrationId', eventType: 'eventType', actionConfig: 'actionConfig', filters: 'filters', enabled: 'enabled' },
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
 * The config a connected install has, per hook integration. Slack/Discord store
 * the target in actionConfig.channelId (via addNotificationChannelFn); every
 * other connector stores it in config.channelId. Stripe/Freshdesk/Salesforce use
 * a nominal placeholder — the resolver requires a non-empty channelId, but those
 * hooks ignore the resolved value.
 */
const CONNECTED_FIXTURES: Record<string, { integrationConfig?: Record<string, unknown>; actionConfig?: Record<string, unknown> }> = {
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
  stripe: { integrationConfig: { channelId: 'stripe' } },
  freshdesk: { integrationConfig: { channelId: 'freshdesk' } },
  salesforce: { integrationConfig: { channelId: 'salesforce' } },
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

const hookTypes = listIntegrationTypes().filter((t) => getIntegrationHook(t))

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
})

describe('integration target coverage', () => {
  it('every hook-bearing integration has a connected-state fixture', () => {
    expect(hookTypes, 'hookTypes is empty — registry not loaded').not.toHaveLength(0)
    const missing = hookTypes.filter((t) => !CONNECTED_FIXTURES[t])
    expect(missing, `add a CONNECTED_FIXTURES entry for: ${missing.join(', ')}`).toEqual([])
  })

  it.each(hookTypes)('resolves a delivery target for "%s" when connected', async (type) => {
    const fixture = CONNECTED_FIXTURES[type] ?? {}
    mockCacheGet
      .mockResolvedValueOnce([
        {
          eventType: 'post.created',
          integrationType: type,
          secrets: JSON.stringify({ accessToken: 'token' }),
          integrationConfig: fixture.integrationConfig ?? {},
          actionConfig: fixture.actionConfig ?? {},
          filters: null,
        },
      ]) // INTEGRATION_MAPPINGS
      .mockResolvedValueOnce([]) // ACTIVE_WEBHOOKS

    const targets = await getHookTargets(makePostCreatedEvent())
    expect(targets.filter((t) => t.type === type).length).toBeGreaterThan(0)
  })
})
