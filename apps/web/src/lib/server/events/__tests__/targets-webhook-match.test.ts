import { describe, it, expect, vi } from 'vitest'

// --- Minimal mocks so targets.ts module loads ---

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
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
    select: vi.fn(),
    query: {
      webhooks: { findMany: vi.fn() },
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
const { webhookSubscriptionMatches } = await import('../targets')

import type { EventData } from '../types'

const base = { id: 'evt', timestamp: '2026-06-05T00:00:00.000Z', actor: { type: 'user' as const } }

const postEvent = {
  ...base,
  type: 'post.created' as const,
  data: {
    post: {
      id: 'post_1',
      title: 't',
      content: 'c',
      boardId: 'board_A',
      boardSlug: 's',
      voteCount: 0,
    },
  },
} as EventData

const chatEvent = {
  ...base,
  type: 'conversation.created' as const,
  data: {
    conversation: {
      id: 'conversation_1',
      status: 'open',
      channel: 'live_chat',
      priority: 'none',
      subject: null,
      visitorPrincipalId: 'p',
      visitorEmail: null,
      assignedAgentPrincipalId: null,
      createdAt: base.timestamp,
      lastMessageAt: base.timestamp,
      resolvedAt: null,
    },
  },
} as EventData

describe('webhookSubscriptionMatches', () => {
  it('requires the webhook to subscribe to the event type', () => {
    expect(
      webhookSubscriptionMatches({ events: ['post.created'], boardIds: null }, postEvent)
    ).toBe(true)
    expect(
      webhookSubscriptionMatches({ events: ['comment.created'], boardIds: null }, postEvent)
    ).toBe(false)
  })

  it('applies the board filter to board-bearing post events', () => {
    expect(
      webhookSubscriptionMatches({ events: ['post.created'], boardIds: ['board_A'] }, postEvent)
    ).toBe(true)
    expect(
      webhookSubscriptionMatches({ events: ['post.created'], boardIds: ['board_B'] }, postEvent)
    ).toBe(false)
  })

  it('ignores the board filter for chat events (board-agnostic)', () => {
    expect(
      webhookSubscriptionMatches(
        { events: ['conversation.created'], boardIds: ['board_A'] },
        chatEvent
      )
    ).toBe(true)
    expect(
      webhookSubscriptionMatches({ events: ['conversation.created'], boardIds: null }, chatEvent)
    ).toBe(true)
    expect(
      webhookSubscriptionMatches({ events: ['message.created'], boardIds: ['board_A'] }, chatEvent)
    ).toBe(false)
  })
})
