/**
 * POST /api/internal/wake — the cross-process doorbell.
 *
 * Auth matches the fleet-internal token check. An unknown workspace still
 * answers 204 (membership is not leaked) and kicks a rate-limited refresh so
 * a freshly provisioned tenant's loops start without waiting for the rescan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signalJob = vi.fn()
const refreshJob = vi.fn()

vi.mock('@/lib/server/jobs/tier', () => ({
  signalWorkspace: (...a: unknown[]) => signalJob(...a),
  requestWorkspaceLoopRefresh: (...a: unknown[]) => refreshJob(...a),
}))

import { handleInternalWake, __resetInternalWakeForTests } from '../wake'

const TOKEN = 'fleet-internal-test-token'
const WORKSPACE_KEY = 'ws_wake_test'

function request(opts: {
  token?: string | null
  headerToken?: string
  body?: unknown
  rawBody?: string
}): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.headerToken) headers.set('x-quackback-fleet-internal-token', opts.headerToken)
  const body = opts.rawBody ?? JSON.stringify(opts.body ?? { workspaceKey: WORKSPACE_KEY })
  return new Request('http://worker.test/api/internal/wake', { method: 'POST', headers, body })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetInternalWakeForTests()
  vi.stubEnv('QUACKBACK_FLEET_INTERNAL_TOKEN', TOKEN)
  vi.stubEnv('QUACKBACK_ROLE', 'worker')
  signalJob.mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('POST /api/internal/wake auth', () => {
  it('rejects a missing token', async () => {
    const res = await handleInternalWake(request({ token: null }))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(signalJob).not.toHaveBeenCalled()
  })

  it('rejects a wrong token', async () => {
    const res = await handleInternalWake(request({ token: 'not-the-token' }))
    expect(res.status).toBe(401)
    expect(signalJob).not.toHaveBeenCalled()
  })

  it('accepts the same secret on the raw header', async () => {
    const res = await handleInternalWake(request({ token: null, headerToken: TOKEN }))
    expect(res.status).toBe(204)
    expect(signalJob).toHaveBeenCalledWith(WORKSPACE_KEY)
  })
})

describe('POST /api/internal/wake', () => {
  it('signals the job tier and returns 204', async () => {
    const res = await handleInternalWake(request({ token: TOKEN }))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(signalJob).toHaveBeenCalledWith(WORKSPACE_KEY)
    expect(refreshJob).not.toHaveBeenCalled()
  })

  it('returns 204 for an unknown workspace and kicks a loop refresh', async () => {
    signalJob.mockReturnValue(false)
    const res = await handleInternalWake(
      request({ token: TOKEN, body: { workspaceKey: 'ws_unknown' } })
    )
    expect(res.status).toBe(204)
    expect(refreshJob).toHaveBeenCalledTimes(1)
  })

  it('rate-limits the unknown-workspace refresh to at least 30s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    signalJob.mockReturnValue(false)

    expect((await handleInternalWake(request({ token: TOKEN }))).status).toBe(204)
    expect((await handleInternalWake(request({ token: TOKEN }))).status).toBe(204)
    expect(refreshJob).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-08-17T12:00:29.000Z'))
    expect((await handleInternalWake(request({ token: TOKEN }))).status).toBe(204)
    expect(refreshJob).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-08-17T12:00:30.000Z'))
    expect((await handleInternalWake(request({ token: TOKEN }))).status).toBe(204)
    expect(refreshJob).toHaveBeenCalledTimes(2)
  })

  it('no-ops with a warn when this process does not run workers', async () => {
    vi.stubEnv('QUACKBACK_ROLE', 'web')
    const res = await handleInternalWake(request({ token: TOKEN }))
    expect(res.status).toBe(204)
    expect(signalJob).not.toHaveBeenCalled()
    expect(refreshJob).not.toHaveBeenCalled()
  })
})
