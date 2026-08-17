/**
 * The web-side worker nudge: fire-and-forget, throttled, never on the
 * request's critical path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

describe('nudgeWorker', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.unstubAllEnvs()
  })

  afterEach(async () => {
    const { __resetWakeNudgeForTests } = await import('../wake-nudge')
    __resetWakeNudgeForTests()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is a no-op when QUACKBACK_WORKER_WAKE_URL is unset', async () => {
    delete process.env.QUACKBACK_WORKER_WAKE_URL
    const { nudgeWorker } = await import('../wake-nudge')
    nudgeWorker('ws_a')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the workspace key and ignores the response', async () => {
    vi.stubEnv('QUACKBACK_WORKER_WAKE_URL', 'http://worker.internal:3000')
    vi.stubEnv('QUACKBACK_FLEET_INTERNAL_TOKEN', 'tok')
    vi.resetModules()
    const { nudgeWorker } = await import('../wake-nudge')
    nudgeWorker('ws_a')
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://worker.internal:3000/api/internal/wake')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ workspaceKey: 'ws_a' }))
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
  })

  it('throttles to one fetch per workspace per 5s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    vi.stubEnv('QUACKBACK_WORKER_WAKE_URL', 'http://worker.internal:3000/api/internal/wake')
    vi.stubEnv('QUACKBACK_FLEET_INTERNAL_TOKEN', 'tok')
    vi.resetModules()
    const { nudgeWorker } = await import('../wake-nudge')
    nudgeWorker('ws_a')
    nudgeWorker('ws_a')
    nudgeWorker('ws_b')
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.setSystemTime(new Date('2026-08-17T12:00:04.999Z'))
    nudgeWorker('ws_a')
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.setSystemTime(new Date('2026-08-17T12:00:05.000Z'))
    nudgeWorker('ws_a')
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('returns immediately when the worker never answers', async () => {
    vi.stubEnv('QUACKBACK_WORKER_WAKE_URL', 'http://worker.internal:3000')
    vi.stubEnv('QUACKBACK_FLEET_INTERNAL_TOKEN', 'tok')
    fetchMock.mockImplementation(() => new Promise(() => {}))
    vi.resetModules()
    const { nudgeWorker } = await import('../wake-nudge')
    const started = Date.now()
    nudgeWorker('ws_hung')
    expect(Date.now() - started).toBeLessThan(50)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
