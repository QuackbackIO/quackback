/**
 * webhook handler — delivery audit row coverage.
 *
 * Asserts that every terminal outcome of `webhookHook.run()` writes one
 * `recordDeliveryAttempt(...)` row, and that a logging failure never breaks
 * the dispatch pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordDeliveryAttemptMock = vi.fn().mockResolvedValue(undefined)
const dnsResolve4Mock = vi.fn()
const dnsResolve6Mock = vi.fn()

vi.mock('dns/promises', () => ({
  default: {
    resolve4: (...args: unknown[]) => dnsResolve4Mock(...args),
    resolve6: (...args: unknown[]) => dnsResolve6Mock(...args),
  },
  resolve4: (...args: unknown[]) => dnsResolve4Mock(...args),
  resolve6: (...args: unknown[]) => dnsResolve6Mock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  },
  webhooks: { id: 'id', failureCount: 'fc', status: 's' },
  eq: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/server/domains/webhooks/webhook.deliveries', () => ({
  recordDeliveryAttempt: (...args: unknown[]) => recordDeliveryAttemptMock(...args),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  recordDeliveryAttemptMock.mockReset().mockResolvedValue(undefined)
  dnsResolve4Mock.mockReset().mockResolvedValue(['8.8.8.8'])
  dnsResolve6Mock.mockReset().mockResolvedValue([])
  fetchMock.mockReset()
})

const event = {
  type: 'post.created',
  timestamp: new Date('2026-04-29T00:00:00.000Z').toISOString(),
  data: { id: 'post_1' },
} as never

const target = { url: 'https://example.com/hook' } as never
const config = { secret: 'shh', webhookId: 'webhook_1', attemptNumber: 2 } as never

async function loadHandler() {
  const mod = await import('../handlers/webhook')
  return mod.webhookHook
}

// Helper to wait for fire-and-forget recordAttempt promise.
async function flush() {
  await new Promise((r) => setImmediate(r))
}

describe('webhookHook.run delivery audit', () => {
  it('writes status=success on a 2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    })
    const handler = await loadHandler()
    const res = await handler.run(event, target, config)
    await flush()
    expect(res.success).toBe(true)
    expect(recordDeliveryAttemptMock).toHaveBeenCalledTimes(1)
    expect(recordDeliveryAttemptMock.mock.calls[0][0]).toMatchObject({
      status: 'success',
      httpStatus: 200,
      attemptNumber: 2,
      eventType: 'post.created',
    })
  })

  it('writes status=failed_retryable on 5xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('boom'),
    })
    const handler = await loadHandler()
    const res = await handler.run(event, target, config)
    await flush()
    expect(res).toMatchObject({ success: false, shouldRetry: true })
    expect(recordDeliveryAttemptMock.mock.calls[0][0]).toMatchObject({
      status: 'failed_retryable',
      httpStatus: 503,
    })
  })

  it('writes status=failed_terminal on 4xx (non-429)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad'),
    })
    const handler = await loadHandler()
    const res = await handler.run(event, target, config)
    await flush()
    expect(res).toMatchObject({ success: false, shouldRetry: false })
    expect(recordDeliveryAttemptMock.mock.calls[0][0]).toMatchObject({
      status: 'failed_terminal',
      httpStatus: 400,
    })
  })

  it('writes status=failed_retryable on 429', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
    })
    const handler = await loadHandler()
    await handler.run(event, target, config)
    await flush()
    expect(recordDeliveryAttemptMock.mock.calls[0][0]).toMatchObject({
      status: 'failed_retryable',
      httpStatus: 429,
    })
  })

  it('writes status=blocked_ssrf when DNS resolves to a private IP', async () => {
    dnsResolve4Mock.mockResolvedValue(['10.0.0.1'])
    const handler = await loadHandler()
    const res = await handler.run(event, target, config)
    await flush()
    expect(res).toMatchObject({ success: false, shouldRetry: false })
    expect(recordDeliveryAttemptMock.mock.calls[0][0]).toMatchObject({
      status: 'blocked_ssrf',
    })
    // fetch must NOT have been called
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not break dispatch when recordDeliveryAttempt throws', async () => {
    recordDeliveryAttemptMock.mockRejectedValueOnce(new Error('audit down'))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    })
    const handler = await loadHandler()
    const res = await handler.run(event, target, config)
    await flush()
    expect(res.success).toBe(true)
  })
})
