/**
 * Differential-coverage tests for webhook.deliveries — best-effort attempt
 * recording (snippet clamp, default fill-in, error swallow) and the
 * list/get read paths with status/cursor/since filters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const tail: Record<string, unknown> = { orderBy: () => tail, limit: () => m.limitMock() }
  return {
    limitMock: vi.fn(),
    insertValues: vi.fn(),
    tail,
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: () => ({ values: (v: unknown) => m.insertValues(v) }),
    select: () => ({ from: () => ({ where: () => m.tail }) }),
  },
  eq: vi.fn(),
  and: vi.fn((...a) => ({ and: a })),
  or: vi.fn((...a) => ({ or: a })),
  lt: vi.fn(),
  desc: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true }),
  webhookDeliveries: {
    webhookId: 'wd.webhookId',
    status: 'wd.status',
    attemptedAt: 'wd.attemptedAt',
    id: 'wd.id',
  },
}))

import {
  recordDeliveryAttempt,
  listDeliveriesForWebhook,
  listFailedDeliveries,
  getDelivery,
} from '../webhook.deliveries'

const base = {
  webhookId: 'wh_1' as never,
  eventId: 'evt_1',
  eventType: 'ticket.created',
  attemptNumber: 1,
  status: 'success' as const,
  requestUrl: 'https://x',
  requestPayloadBytes: 100,
  signatureTimestamp: 123,
}

beforeEach(() => {
  vi.clearAllMocks()
  m.limitMock.mockResolvedValue([{ id: 'del_1' }])
  m.insertValues.mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('recordDeliveryAttempt', () => {
  it('records with all fields and clamps a long snippet', async () => {
    await recordDeliveryAttempt({
      ...base,
      httpStatus: 200,
      errorMessage: null,
      requestPayloadJson: { a: 1 },
      requestPayloadTruncated: true,
      responseBodySnippet: 'x'.repeat(600),
      latencyMs: 42,
      nextRetryAt: new Date(),
    })
    const stored = m.insertValues.mock.calls[0][0] as { responseBodySnippet: string }
    expect(stored.responseBodySnippet).toHaveLength(500)
  })
  it('records with minimal input (null snippet + defaults)', async () => {
    await recordDeliveryAttempt(base)
    const stored = m.insertValues.mock.calls[0][0] as {
      responseBodySnippet: string | null
      requestPayloadTruncated: boolean
    }
    expect(stored.responseBodySnippet).toBeNull()
    expect(stored.requestPayloadTruncated).toBe(false)
  })
  it('swallows an insert failure', async () => {
    m.insertValues.mockRejectedValueOnce(new Error('db down'))
    await expect(recordDeliveryAttempt(base)).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('listDeliveriesForWebhook', () => {
  it('applies status filter and cursor', async () => {
    const res = await listDeliveriesForWebhook('wh_1' as never, {
      statusFilter: 'failed_retryable',
      cursor: { attemptedAt: new Date('2026-01-01'), id: 'del_0' as never },
      limit: 10,
    })
    expect(res).toEqual([{ id: 'del_1' }])
  })
  it('runs with defaults (no filter/cursor)', async () => {
    expect(await listDeliveriesForWebhook('wh_1' as never)).toEqual([{ id: 'del_1' }])
  })
})

describe('listFailedDeliveries', () => {
  it('applies a sinceMs window', async () => {
    expect(await listFailedDeliveries({ sinceMs: 60_000, limit: 5 })).toEqual([{ id: 'del_1' }])
  })
  it('ignores a zero/absent sinceMs', async () => {
    expect(await listFailedDeliveries({ sinceMs: 0 })).toEqual([{ id: 'del_1' }])
    expect(await listFailedDeliveries()).toEqual([{ id: 'del_1' }])
  })
})

describe('getDelivery', () => {
  it('returns the row when found', async () => {
    expect(await getDelivery('del_1' as never)).toEqual({ id: 'del_1' })
  })
  it('returns null when missing', async () => {
    m.limitMock.mockResolvedValueOnce([])
    expect(await getDelivery('del_x' as never)).toBeNull()
  })
})
