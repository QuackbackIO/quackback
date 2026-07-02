import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebhookId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  listWebhookDeliveriesFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/webhook-deliveries', () => ({
  listWebhookDeliveriesFn: (input: unknown) => mocks.listWebhookDeliveriesFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  infiniteQueryOptions: (options: unknown) => options,
}))

import { webhookDeliveryQueries } from '../webhook-deliveries'

const webhookId = 'webhook_1' as WebhookId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('webhookDeliveryQueries.all', () => {
  it('exposes the root key', () => {
    expect(webhookDeliveryQueries.all).toEqual(['webhook-deliveries'])
  })
})

describe('webhookDeliveryQueries.list', () => {
  it('defaults to empty filters and forwards an undefined cursor', async () => {
    const options = webhookDeliveryQueries.list(webhookId)
    expect(options.queryKey).toEqual(['webhook-deliveries', 'list', webhookId, {}])
    expect(options.staleTime).toBe(15_000)

    mocks.listWebhookDeliveriesFn.mockResolvedValueOnce({ rows: [], nextCursor: null })
    await options.queryFn!({ pageParam: undefined } as never)

    expect(mocks.listWebhookDeliveriesFn).toHaveBeenCalledWith({
      data: {
        webhookId,
        limit: 50,
        status: undefined,
        cursorAttemptedAt: undefined,
        cursorId: undefined,
      },
    })
  })

  it('forwards the status filter and a populated cursor', async () => {
    const filters = { status: 'failed_terminal' as const }
    const options = webhookDeliveryQueries.list(webhookId, filters)
    expect(options.queryKey).toEqual(['webhook-deliveries', 'list', webhookId, filters])

    mocks.listWebhookDeliveriesFn.mockResolvedValueOnce({ rows: [], nextCursor: null })
    await options.queryFn!({
      pageParam: { cursorAttemptedAt: '2026-01-01T00:00:00.000Z', cursorId: 'd1' },
    } as never)

    expect(mocks.listWebhookDeliveriesFn).toHaveBeenCalledWith({
      data: {
        webhookId,
        limit: 50,
        status: 'failed_terminal',
        cursorAttemptedAt: '2026-01-01T00:00:00.000Z',
        cursorId: 'd1',
      },
    })
  })

  it('reads the next cursor and falls back to undefined when null', () => {
    const options = webhookDeliveryQueries.list(webhookId)
    const cursor = { cursorAttemptedAt: '2026-01-02T00:00:00.000Z', cursorId: 'd2' }

    expect(
      (options.getNextPageParam as (p: unknown) => unknown)({ nextCursor: cursor } as never)
    ).toEqual(cursor)
    expect(
      (options.getNextPageParam as (p: unknown) => unknown)({ nextCursor: null } as never)
    ).toBeUndefined()
  })
})
