/**
 * The test-only routes answer 404 unless the e2e harness gate is open, and the
 * sweep runner never runs a sweep while closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runE2eSweep = vi.fn(async (body: unknown) => ({
  ok: true as const,
  job: (body as { job: string }).job,
  asOf: '2026-01-01T00:00:00.000Z',
  result: {},
}))
vi.mock('@/lib/server/e2e-harness/sweeps', () => ({ runE2eSweep }))

import { handleE2eSweep } from '../e2e/sweep'
import { handleE2ePresenceProbe } from '../e2e/presence'

const KEYS = ['E2E_HARNESS', 'BASE_URL', 'QUACKBACK_TENANCY'] as const
const saved: Record<string, string | undefined> = {}

function sweepRequest(body: unknown): Request {
  return new Request('http://acme.localhost:3000/api/e2e/sweep', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  runE2eSweep.mockClear()
  for (const key of KEYS) saved[key] = process.env[key]
  process.env.BASE_URL = 'http://acme.localhost:3000'
  delete process.env.E2E_HARNESS
  delete process.env.QUACKBACK_TENANCY
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('POST /api/e2e/sweep', () => {
  it('is 404 and runs nothing without E2E_HARNESS=1', async () => {
    const res = await handleE2eSweep(sweepRequest({ job: 'snooze-sweep' }))
    expect(res.status).toBe(404)
    expect(runE2eSweep).not.toHaveBeenCalled()
  })

  it('is 404 and runs nothing with the flag on a public BASE_URL', async () => {
    process.env.E2E_HARNESS = '1'
    process.env.BASE_URL = 'https://feedback.example.com'
    const res = await handleE2eSweep(sweepRequest({ job: 'snooze-sweep' }))
    expect(res.status).toBe(404)
    expect(runE2eSweep).not.toHaveBeenCalled()
  })

  it('is 404 on the pooled fleet even with the flag', async () => {
    process.env.E2E_HARNESS = '1'
    process.env.QUACKBACK_TENANCY = 'pooled'
    const res = await handleE2eSweep(sweepRequest({ job: 'snooze-sweep' }))
    expect(res.status).toBe(404)
    expect(runE2eSweep).not.toHaveBeenCalled()
  })

  it('runs the named sweep when the gate is open', async () => {
    process.env.E2E_HARNESS = '1'
    const res = await handleE2eSweep(sweepRequest({ job: 'snooze-sweep' }))
    expect(res.status).toBe(200)
    expect(runE2eSweep).toHaveBeenCalledWith({ job: 'snooze-sweep' })
    expect(await res.json()).toMatchObject({ ok: true, job: 'snooze-sweep' })
  })

  it('answers 400 to a body that is not JSON', async () => {
    process.env.E2E_HARNESS = '1'
    const res = await handleE2eSweep(
      new Request('http://acme.localhost:3000/api/e2e/sweep', { method: 'POST', body: '{' })
    )
    expect(res.status).toBe(400)
    expect(runE2eSweep).not.toHaveBeenCalled()
  })
})

describe('GET /api/e2e/presence', () => {
  it('is 404 without E2E_HARNESS=1', () => {
    expect(handleE2ePresenceProbe().status).toBe(404)
  })

  it('is 404 with the flag on a public BASE_URL', () => {
    process.env.E2E_HARNESS = '1'
    process.env.BASE_URL = 'https://feedback.example.com'
    expect(handleE2ePresenceProbe().status).toBe(404)
  })

  it('is 204 when the gate is open', () => {
    process.env.E2E_HARNESS = '1'
    expect(handleE2ePresenceProbe().status).toBe(204)
  })
})
