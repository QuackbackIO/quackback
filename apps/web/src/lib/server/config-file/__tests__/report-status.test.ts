import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeReportStatus } from '../report-status'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.QUACKBACK_CP_STATUS_URL
  delete process.env.QUACKBACK_CP_INTERNAL_TOKEN
  delete process.env.QUACKBACK_INSTANCE_ID
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

describe('makeReportStatus', () => {
  it('is a no-op when status-reporter env vars are absent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const report = makeReportStatus()
    await report({ kind: 'ok' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when only some status-reporter env vars are present', async () => {
    process.env.QUACKBACK_CP_STATUS_URL = 'http://cp/api/v1/internal/config-status'
    process.env.QUACKBACK_CP_INTERNAL_TOKEN = 'tok'
    // QUACKBACK_INSTANCE_ID intentionally unset
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const report = makeReportStatus()
    await report({ kind: 'ok' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs the status payload with bearer auth when env vars are set', async () => {
    process.env.QUACKBACK_CP_STATUS_URL = 'http://cp/api/v1/internal/config-status'
    process.env.QUACKBACK_CP_INTERNAL_TOKEN = 'tok'
    process.env.QUACKBACK_INSTANCE_ID = 'inst_123'

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    const report = makeReportStatus()
    await report({ kind: 'ok', configHash: 'abc' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('http://cp/api/v1/internal/config-status')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers['content-type']).toBe('application/json')

    const parsed = JSON.parse(init.body as string) as Record<string, unknown>
    expect(parsed.instanceId).toBe('inst_123')
    expect(parsed.kind).toBe('ok')
    expect(parsed.configHash).toBe('abc')
    expect(typeof parsed.reconciledAt).toBe('string')
  })

  it('treats 400 responses as success (stale-write rejection is benign)', async () => {
    process.env.QUACKBACK_CP_STATUS_URL = 'http://cp/api/v1/internal/config-status'
    process.env.QUACKBACK_CP_INTERNAL_TOKEN = 'tok'
    process.env.QUACKBACK_INSTANCE_ID = 'inst_123'

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('stale', { status: 400 }))

    const report = makeReportStatus()
    await report({ kind: 'ok' })

    // Single call — no retry on 400.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries once on a 5xx and succeeds the second time', async () => {
    process.env.QUACKBACK_CP_STATUS_URL = 'http://cp/api/v1/internal/config-status'
    process.env.QUACKBACK_CP_INTERNAL_TOKEN = 'tok'
    process.env.QUACKBACK_INSTANCE_ID = 'inst_123'

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const report = makeReportStatus()

    vi.useFakeTimers()
    const promise = report({ kind: 'error', message: 'parse failed' })
    await vi.advanceTimersByTimeAsync(1000)
    await promise
    vi.useRealTimers()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('logs but does not throw when both attempts fail', async () => {
    process.env.QUACKBACK_CP_STATUS_URL = 'http://cp/api/v1/internal/config-status'
    process.env.QUACKBACK_CP_INTERNAL_TOKEN = 'tok'
    process.env.QUACKBACK_INSTANCE_ID = 'inst_123'

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const report = makeReportStatus()

    vi.useFakeTimers()
    const promise = report({ kind: 'ok' })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toBeUndefined()
    vi.useRealTimers()

    expect(errSpy).toHaveBeenCalled()
  })
})
