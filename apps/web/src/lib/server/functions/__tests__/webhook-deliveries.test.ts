import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockListDeliveriesForWebhook: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.mockRequireAuth(...args),
}))

vi.mock('@/lib/server/domains/webhooks/webhook.deliveries', () => ({
  listDeliveriesForWebhook: (...args: unknown[]) => hoisted.mockListDeliveriesForWebhook(...args),
}))

await import('../webhook-deliveries')

const [listWebhookDeliveriesFn] = handlersByIndex

if (!listWebhookDeliveriesFn) {
  throw new Error(`webhook delivery handlers were not registered; found ${handlersByIndex.length}`)
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook_delivery_123',
    webhookId: 'webhook_123',
    eventId: 'event_123',
    eventType: 'ticket.created',
    attemptNumber: 1,
    status: 'failed_retryable',
    httpStatus: 500,
    errorMessage: 'server error',
    requestUrl: 'https://example.test/webhook',
    requestPayloadBytes: 120,
    responseBodySnippet: 'oops',
    latencyMs: 42,
    signatureTimestamp: 1_766_000_000,
    attemptedAt: new Date('2026-01-01T00:00:00.000Z'),
    nextRetryAt: new Date('2026-01-01T00:05:00.000Z'),
    requestPayloadJson: { id: 'event_123' },
    requestPayloadTruncated: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({ user: { id: 'user_admin' } })
})

describe('listWebhookDeliveriesFn', () => {
  it('lists deliveries with cursor, next cursor, ISO dates, and redelivery eligibility', async () => {
    const rows = [
      delivery({ id: 'webhook_delivery_1' }),
      delivery({
        id: 'webhook_delivery_2',
        attemptedAt: new Date('2026-01-01T00:01:00.000Z'),
        nextRetryAt: null,
        status: 'success',
        requestPayloadJson: null,
      }),
    ]
    hoisted.mockListDeliveriesForWebhook.mockResolvedValue(rows)

    const result = await listWebhookDeliveriesFn({
      data: {
        webhookId: 'webhook_123',
        limit: 2,
        status: 'failed_retryable',
        cursorAttemptedAt: '2026-01-01T00:00:00.000Z',
        cursorId: 'webhook_delivery_0',
      },
    })

    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin'] })
    expect(hoisted.mockListDeliveriesForWebhook).toHaveBeenCalledWith('webhook_123', {
      cursor: {
        attemptedAt: new Date('2026-01-01T00:00:00.000Z'),
        id: 'webhook_delivery_0',
      },
      limit: 2,
      statusFilter: 'failed_retryable',
    })
    expect(result).toEqual({
      deliveries: [
        expect.objectContaining({
          id: 'webhook_delivery_1',
          attemptedAt: '2026-01-01T00:00:00.000Z',
          nextRetryAt: '2026-01-01T00:05:00.000Z',
          canRedeliver: true,
        }),
        expect.objectContaining({
          id: 'webhook_delivery_2',
          attemptedAt: '2026-01-01T00:01:00.000Z',
          nextRetryAt: null,
          canRedeliver: false,
        }),
      ],
      nextCursor: {
        cursorAttemptedAt: '2026-01-01T00:01:00.000Z',
        cursorId: 'webhook_delivery_2',
      },
    })
  })

  it('lists deliveries without cursor, status filter, or next cursor when fewer rows are returned', async () => {
    hoisted.mockListDeliveriesForWebhook.mockResolvedValue([
      delivery({ status: 'failed_terminal', requestPayloadTruncated: true }),
    ])

    const result = await listWebhookDeliveriesFn({
      data: { webhookId: 'webhook_123', limit: 50 },
    })

    expect(hoisted.mockListDeliveriesForWebhook).toHaveBeenCalledWith('webhook_123', {
      cursor: null,
      limit: 50,
      statusFilter: null,
    })
    expect(result).toMatchObject({
      deliveries: [{ canRedeliver: false }],
      nextCursor: null,
    })
  })

  it('does not list deliveries when admin authentication fails', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('admin required'))

    await expect(
      listWebhookDeliveriesFn({ data: { webhookId: 'webhook_123', limit: 50 } })
    ).rejects.toThrow('admin required')

    expect(hoisted.mockListDeliveriesForWebhook).not.toHaveBeenCalled()
  })
})
