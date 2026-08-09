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

// Background work is one tier now, not a registry of BullMQ workers.
const getJobTierStatus = vi.fn()
vi.mock('@/lib/server/jobs/tier', () => ({
  getJobTierStatus: (...a: unknown[]) => getJobTierStatus(...a),
}))

import { handleLivenessProbe } from '../health.live'
import { handleReadinessProbe, resetReadinessCache } from '../health.ready'

beforeEach(() => {
  vi.clearAllMocks()
  resetReadinessCache()
  execute.mockResolvedValue([])
  ping.mockResolvedValue('PONG')
  getMigrationStatus.mockResolvedValue({ upToDate: true, bundledCount: 1, appliedCount: 1 })
  getJobTierStatus.mockReturnValue({
    running: true,
    tenants: [{ tenantId: 't1', inFlight: 0, schemaMissing: false }],
  })
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
    expect(body.checks.workers).toEqual({
      ok: true,
      expected: true,
      running: true,
      loops: 1,
      inFlight: 0,
      schemaMissing: 0,
    })
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

  it('returns 503 on a worker-role process whose job tier is not running', async () => {
    // The old check computed `ok = failed === 0` over eagerly-initialised BullMQ
    // workers, and a worker that was never CONSTRUCTED is not failed — so a
    // pooled replica running no consumer at all reported
    // `workers ok:true total:0` while every queue accumulated silently. This is
    // the case that reading has to fail.
    getJobTierStatus.mockReturnValue({ running: false, tenants: [] })
    const res = await handleReadinessProbe()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.workers).toMatchObject({ ok: false, expected: true, running: false })
  })

  it('stays ready on a web-role replica, which is not supposed to run the tier', async () => {
    vi.stubEnv('QUACKBACK_ROLE', 'web')
    getJobTierStatus.mockReturnValue({ running: false, tenants: [] })
    const res = await handleReadinessProbe()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks.workers).toMatchObject({ ok: true, expected: false, running: false })
    vi.unstubAllEnvs()
  })

  it('reports how many tenant loops the tier is serving', async () => {
    getJobTierStatus.mockReturnValue({
      running: true,
      tenants: [
        { tenantId: 'a', inFlight: 2, schemaMissing: false },
        { tenantId: 'b', inFlight: 1, schemaMissing: true },
      ],
    })
    const res = await handleReadinessProbe()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.checks.workers).toMatchObject({ loops: 2, inFlight: 3, schemaMissing: 1 })
  })
})
