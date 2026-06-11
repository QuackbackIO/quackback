/**
 * Tests that internal and shared-team ticket threads are never delivered
 * to external targets (webhooks and integrations).
 *
 * Security invariant: only `audience: 'public'` threads reach external consumers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Minimal mocks so targets.ts module loads ---

const cacheGetMock = vi.fn()
const cacheSetMock = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: (...a: unknown[]) => cacheGetMock(...a),
  cacheSet: (...a: unknown[]) => cacheSetMock(...a),
  cacheDel: vi.fn(),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
    INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
    ACTIVE_WEBHOOKS: 'hooks:webhooks-active',
    SLACK_CHANNELS: 'slack:channels',
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi
      .fn()
      .mockReturnValue({
        from: vi
          .fn()
          .mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
      }),
    query: {
      webhooks: { findMany: vi.fn().mockResolvedValue([]) },
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
  webhooks: { status: 'status', deletedAt: 'deletedAt', $inferSelect: {} },
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
    role: 'principal.role',
    type: 'principal.type',
    displayName: 'principal.displayName',
  },
  user: { id: 'user.id', email: 'user.email' },
  posts: {
    id: 'posts.id',
    boardId: 'posts.boardId',
    moderationState: 'posts.moderationState',
    principalId: 'posts.principalId',
    deletedAt: 'posts.deletedAt',
  },
  boards: { id: 'boards.id', access: 'boards.access', deletedAt: 'boards.deletedAt' },
  userSegments: { principalId: 'userSegments.principalId', segmentId: 'userSegments.segmentId' },
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  or: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
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
    workspaceName: 'Test Workspace',
    portalBaseUrl: 'https://test.quackback.io',
    logoUrl: null,
  }),
}))

vi.mock('../hook-utils', () => ({
  stripHtml: vi.fn((s: string) => s),
  truncate: vi.fn((s: string) => s),
}))

// Import after mocks
const { getHookTargets } = await import('../targets')

import type { EventData } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const base = {
  id: 'evt_test_thread',
  timestamp: '2026-06-11T00:00:00.000Z',
  actor: { type: 'user' as const, principalId: 'principal_agent1' },
}

const ticketRef = {
  id: 'ticket_01test',
  subject: 'Test ticket',
  descriptionText: 'Body',
  statusId: 'ticket_status_open',
  statusCategory: 'open',
  priority: 'normal',
  channel: 'portal',
  visibility: 'team',
  inboxId: 'inbox_01',
  primaryTeamId: 'team_01',
  assigneePrincipalId: 'principal_agent1',
  assigneeTeamId: null,
  requesterPrincipalId: 'principal_user1',
  requesterContactId: null,
}

function threadEvent(audience: 'public' | 'internal' | 'shared_team'): EventData {
  return {
    ...base,
    type: 'ticket.thread_added',
    data: {
      ticket: ticketRef,
      threadId: 'ticket_thread_01',
      audience,
      sharedWithTeamId: audience === 'shared_team' ? 'team_02' : null,
      thread: {
        id: 'ticket_thread_01',
        audience,
        bodyTextPreview: 'This is a test message',
        bodyTextTruncated: false,
        authorPrincipalId: 'principal_agent1',
        isFromRequester: false,
        sharedWithTeamId: audience === 'shared_team' ? 'team_02' : null,
        createdAt: base.timestamp,
      },
    },
  } as EventData
}

// ---------------------------------------------------------------------------
// Setup: configure mocks to return one active webhook and one integration
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Return one active webhook subscribed to ticket.thread_added
  cacheGetMock.mockImplementation((key: string) => {
    if (key === 'hooks:webhooks-active') {
      return [
        {
          id: 'webhook_01',
          url: 'https://example.com/hook',
          events: ['ticket.thread_added'],
          boardIds: null,
          inboxIds: null,
          status: 'active',
          secret: 'test-secret',
          deletedAt: null,
          failureCount: 0,
        },
      ]
    }
    if (key === 'hooks:integration-mappings') {
      return [
        {
          integrationId: 'integration_slack1',
          integrationType: 'slack',
          eventType: 'ticket.thread_added',
          actionConfig: { channelId: '#support' },
          integrationConfig: {},
          filters: null,
          secrets: JSON.stringify({ accessToken: 'xoxb-test' }),
        },
      ]
    }
    return null
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ticket thread visibility — webhook and integration targets', () => {
  it('blocks internal threads from all external targets', async () => {
    const targets = await getHookTargets(threadEvent('internal'))
    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    const integrationTargets = targets.filter(
      (t) => t.type !== 'webhook' && t.type !== 'email' && t.type !== 'notification'
    )
    expect(webhookTargets).toHaveLength(0)
    expect(integrationTargets).toHaveLength(0)
  })

  it('blocks shared_team threads from all external targets', async () => {
    const targets = await getHookTargets(threadEvent('shared_team'))
    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    const integrationTargets = targets.filter(
      (t) => t.type !== 'webhook' && t.type !== 'email' && t.type !== 'notification'
    )
    expect(webhookTargets).toHaveLength(0)
    expect(integrationTargets).toHaveLength(0)
  })

  it('allows public threads to reach webhook targets', async () => {
    const targets = await getHookTargets(threadEvent('public'))
    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    expect(webhookTargets.length).toBeGreaterThan(0)
  })

  it('allows public threads to reach integration targets', async () => {
    const targets = await getHookTargets(threadEvent('public'))
    const integrationTargets = targets.filter((t) => t.type === 'slack')
    expect(integrationTargets.length).toBeGreaterThan(0)
  })
})

describe('private comment visibility — regression', () => {
  it('blocks private comments from webhook and integration targets', async () => {
    const event = {
      ...base,
      type: 'comment.created',
      data: {
        comment: {
          id: 'comment_01',
          content: 'secret internal note',
          isPrivate: true,
        },
        post: {
          id: 'post_01',
          title: 'Feedback',
          boardId: 'board_01',
          boardSlug: 'feedback',
        },
      },
    } as EventData

    const targets = await getHookTargets(event)
    const webhookTargets = targets.filter((t) => t.type === 'webhook')
    const integrationTargets = targets.filter(
      (t) => t.type !== 'webhook' && t.type !== 'email' && t.type !== 'notification'
    )
    expect(webhookTargets).toHaveLength(0)
    expect(integrationTargets).toHaveLength(0)
  })
})
