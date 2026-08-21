import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const execute = vi.fn()
const getMigrationStatus = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: { execute: (...a: unknown[]) => execute(...a) },
  sql: (strings: TemplateStringsArray) => strings.join('?'),
  getMigrationStatus: (...a: unknown[]) => getMigrationStatus(...a),
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
  getMigrationStatus.mockResolvedValue({ upToDate: true, bundledCount: 1, appliedCount: 1 })
  getJobTierStatus.mockReturnValue({
    running: true,
    tenants: [{ tenantId: 't1', inFlight: 0, schemaMissing: false, refusedCode: null }],
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
    // Liveness must answer from nothing: a dependency outage restarts a pod
    // only if liveness reads the dependency, which is how a database blip
    // turns into a cluster-wide restart loop.
    expect(execute).not.toHaveBeenCalled()
    expect(getMigrationStatus).not.toHaveBeenCalled()
    expect(getJobTierStatus).not.toHaveBeenCalled()
  })
})

describe('GET /api/health/ready', () => {
  it('returns 200 with a per-check breakdown when everything passes', async () => {
    const res = await handleReadinessProbe()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks.db).toEqual({ ok: true })
    expect(body.checks.migrations).toEqual({ ok: true })
    // The probe reports exactly the dependencies it checks. Pinned as a set so
    // a check that stops being evaluated cannot keep a stale key in the body,
    // and so a re-added dependency has to be asserted rather than appear.
    expect(Object.keys(body.checks).sort()).toEqual(['db', 'migrations', 'workers'])
    expect(body.checks.workers).toEqual({
      ok: true,
      expected: true,
      running: true,
      loops: 1,
      inFlight: 0,
      schemaMissing: 0,
      // `refused` is how a tenant that has stopped being retried stays visible;
      // it deliberately does not fail the probe, because a bad registry record
      // is not this replica's fault.
      refused: 0,
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
    // A hanging dependency is the case a probe exists for and the one it is
    // worst at: without the per-check budget the request never answers, the
    // orchestrator's own probe timeout fires, and the body that says WHICH
    // dependency hung is never produced. This used to hang Redis; it hangs the
    // database now, which is the dependency that actually exists.
    vi.useFakeTimers()
    execute.mockImplementation(() => new Promise(() => {}))
    const resPromise = handleReadinessProbe()
    await vi.advanceTimersByTimeAsync(3_000)
    const res = await resPromise
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.checks.db).toEqual({ ok: false, error: 'timeout' })
    // The other checks still report individually, so the body localises the
    // fault instead of just saying "not ready".
    expect(body.checks.migrations).toEqual({ ok: true })
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
