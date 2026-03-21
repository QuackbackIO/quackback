/**
 * Webhook service cache invalidation tests.
 *
 * Verifies that createWebhook, updateWebhook, deleteWebhook,
 * and rotateWebhookSecret invalidate the ACTIVE_WEBHOOKS cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Redis cache mocks ---
const mockCacheDel = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: {
    ACTIVE_WEBHOOKS: 'hooks:webhooks-active',
  },
}))

// --- DB mocks ---
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()
const mockFindFirst = vi.fn()

function makeWebhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook_test1',
    url: 'https://example.com/hook',
    secret: 'encrypted',
    events: ['post.created'],
    boardIds: null,
    status: 'active',
    failureCount: 0,
    lastError: null,
    lastTriggeredAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    createdById: 'principal_1',
    deletedAt: null,
    ...overrides,
  }
}

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      webhooks: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
  webhooks: {
    id: 'id',
    status: 'status',
    deletedAt: 'deletedAt',
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('../encryption', () => ({
  encryptWebhookSecret: vi.fn().mockReturnValue('encrypted-secret'),
}))

vi.mock('@/lib/server/events/integrations/webhook/constants', () => ({
  isValidWebhookUrl: vi.fn().mockReturnValue(true),
}))

vi.mock('@quackback/ids', () => ({
  createId: vi.fn().mockReturnValue('webhook_new1'),
}))

const { createWebhook, updateWebhook, deleteWebhook, rotateWebhookSecret } =
  await import('../webhook.service')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheDel.mockResolvedValue(undefined)
})

describe('webhook service cache invalidation', () => {
  it('createWebhook invalidates ACTIVE_WEBHOOKS cache', async () => {
    // Mock: count query returns 0
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([{ count: 0 }]),
    })
    // Mock: insert chain
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([makeWebhookRow({ id: 'webhook_new1' })]),
      }),
    })

    await createWebhook(
      { url: 'https://example.com/hook', events: ['post.created'] },
      'principal_1' as any
    )

    expect(mockCacheDel).toHaveBeenCalledWith('hooks:webhooks-active')
  })

  it('updateWebhook invalidates ACTIVE_WEBHOOKS cache', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([makeWebhookRow()]),
        }),
      }),
    })

    await updateWebhook('webhook_test1' as any, { status: 'disabled' })

    expect(mockCacheDel).toHaveBeenCalledWith('hooks:webhooks-active')
  })

  it('deleteWebhook invalidates ACTIVE_WEBHOOKS cache', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([makeWebhookRow({ deletedAt: new Date() })]),
        }),
      }),
    })

    await deleteWebhook('webhook_test1' as any)

    expect(mockCacheDel).toHaveBeenCalledWith('hooks:webhooks-active')
  })

  it('rotateWebhookSecret invalidates ACTIVE_WEBHOOKS cache', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([makeWebhookRow()]),
        }),
      }),
    })

    await rotateWebhookSecret('webhook_test1' as any)

    expect(mockCacheDel).toHaveBeenCalledWith('hooks:webhooks-active')
  })
})
