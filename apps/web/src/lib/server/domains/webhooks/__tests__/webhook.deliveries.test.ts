/**
 * webhook.deliveries — recordDeliveryAttempt is fire-and-forget; INSERT
 * failures must never throw out to the caller, and `responseBodySnippet`
 * is truncated to 500 chars so we never balloon the audit row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertValuesMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  lt: vi.fn(),
  desc: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  webhookDeliveries: {
    id: 'col.id',
    webhookId: 'col.webhookId',
    attemptedAt: 'col.attemptedAt',
    status: 'col.status',
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  insertValuesMock.mockReset()
})

describe('recordDeliveryAttempt', () => {
  it('truncates responseBodySnippet to 500 chars before insert', async () => {
    insertValuesMock.mockResolvedValue(undefined)
    const long = 'x'.repeat(2_000)
    const { recordDeliveryAttempt } = await import('../webhook.deliveries')
    await recordDeliveryAttempt({
      webhookId: 'webhook_1' as never,
      eventId: 'evt_1',
      eventType: 'post.created',
      attemptNumber: 1,
      status: 'success',
      requestUrl: 'https://example.com',
      requestPayloadBytes: 100,
      responseBodySnippet: long,
      signatureTimestamp: 1700000000,
    })
    expect(insertValuesMock).toHaveBeenCalledOnce()
    const arg = insertValuesMock.mock.calls[0][0]
    expect(arg.responseBodySnippet.length).toBe(500)
  })

  it('swallows INSERT failures (best-effort)', async () => {
    insertValuesMock.mockRejectedValueOnce(new Error('db down'))
    const { recordDeliveryAttempt } = await import('../webhook.deliveries')
    await expect(
      recordDeliveryAttempt({
        webhookId: 'webhook_1' as never,
        eventId: 'evt_1',
        eventType: 'post.created',
        attemptNumber: 1,
        status: 'failed_terminal',
        requestUrl: 'https://example.com',
        requestPayloadBytes: 50,
        signatureTimestamp: 1700000000,
      })
    ).resolves.toBeUndefined()
  })
})
