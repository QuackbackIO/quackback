import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const execute = vi.fn()
const getMigrationStatus = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: { execute: (...a: unknown[]) => execute(...a) },
  sql: (strings: TemplateStringsArray) => strings.join('?'),
  getMigrationStatus: (...a: unknown[]) => getMigrationStatus(...a),
}))

const ping = vi.fn()
vi.mock('@/lib/server/queue/redis-config', () => ({
  getQueueRedis: () => ({ ping: (...a: unknown[]) => ping(...a) }),
}))

const getWorkerBootStatus = vi.fn()
vi.mock('@/lib/server/queue/worker-registry', () => ({
  getWorkerBootStatus: (...a: unknown[]) => getWorkerBootStatus(...a),
}))

import { handleLivenessProbe } from '../health.live'
import { handleReadinessProbe, resetReadinessCache } from '../health.ready'

beforeEach(() => {
  vi.clearAllMocks()
  resetReadinessCache()
  execute.mockResolvedValue([])
  ping.mockResolvedValue('PONG')
  getMigrationStatus.mockResolvedValue({ upToDate: true, bundledCount: 1, appliedCount: 1 })
  getWorkerBootStatus.mockReturnValue({ total: 5, running: 5, pending: 0, failed: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/health/live', () => {
  it('returns 200 without touching any dependency', async () => {
    const res = handleLivenessProbe()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
    expect(execute).not.toHaveBeenCalled()
    expect(ping).not.toHaveBeenCalled()
  })
})

describe('GET /api/health/ready', () => {
  it('returns 200 with a per-check breakdown when everything passes', async () => {
    const res = await handleReadinessProbe()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks.db).toEqual({ ok: true })
    expect(body.checks.redis).toEqual({ ok: true })
    expect(body.checks.migrations).toEqual({ ok: true })
    expect(body.checks.workers).toEqual({ ok: true, total: 5, running: 5, pending: 0, failed: 0 })
  })

  it('returns 503 when the db check fails, without leaking error detail', async () => {
    execute.mockRejectedValue(new Error('connect ECONNREFUSED postgres://user:secret@db:5432'))
    const res = await handleReadinessProbe()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('unavailable')
    expect(body.checks.db).toEqual({ ok: false, error: 'failed' })
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })

  it('memoizes a passing migrations check across probes', async () => {
    await handleReadinessProbe()
    await handleReadinessProbe()
    expect(getMigrationStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps polling migrations while behind', async () => {
    getMigrationStatus.mockResolvedValue({ upToDate: false, bundledCount: 2, appliedCount: 1 })
    await handleReadinessProbe()
    await handleReadinessProbe()
    expect(getMigrationStatus).toHaveBeenCalledTimes(2)
  })

  it('returns 503 with error "behind" when migrations lag the bundled ledger', async () => {
    getMigrationStatus.mockResolvedValue({ upToDate: false, bundledCount: 2, appliedCount: 1 })
    const res = await handleReadinessProbe()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.migrations).toEqual({ ok: false, error: 'behind' })
  })

  it('degrades to 503 with error "timeout" when a dependency hangs', async () => {
    vi.useFakeTimers()
    ping.mockImplementation(() => new Promise(() => {}))
    const resPromise = handleReadinessProbe()
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await resPromise
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.redis).toEqual({ ok: false, error: 'timeout' })
    // The other checks still report individually.
    expect(body.checks.db).toEqual({ ok: true })
  })

  it('returns 503 when a worker failed to boot', async () => {
    getWorkerBootStatus.mockReturnValue({ total: 5, running: 4, pending: 0, failed: 1 })
    const res = await handleReadinessProbe()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.workers).toEqual({
      ok: false,
      total: 5,
      running: 4,
      pending: 0,
      failed: 1,
    })
  })

  it('stays ready while workers are still booting', async () => {
    getWorkerBootStatus.mockReturnValue({ total: 5, running: 3, pending: 2, failed: 0 })
    const res = await handleReadinessProbe()
    expect(res.status).toBe(200)
  })
})
