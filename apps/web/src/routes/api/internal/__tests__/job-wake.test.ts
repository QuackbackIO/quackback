import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  handle: vi.fn(),
  running: vi.fn(),
}))

vi.mock('@/lib/server/fleet/internal-auth', () => ({
  authorizeFleetInternal: mocks.authorize,
}))
vi.mock('@/lib/server/jobs/worker', () => ({
  handleJobWake: mocks.handle,
  isJobWorkerRunning: mocks.running,
}))

import { handleJobWakeRequest } from '../job-wake'

function request(body: unknown, authed = true): Request {
  mocks.authorize.mockReturnValue(authed)
  return new Request('http://worker/api/internal/job-wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.authorize.mockReset()
  mocks.handle.mockReset().mockResolvedValue(undefined)
  mocks.running.mockReset().mockReturnValue(true)
})

describe('POST /api/internal/job-wake', () => {
  it('refuses a missing fleet token without touching the worker', async () => {
    const response = await handleJobWakeRequest(request({ workspaceKey: 'inst_a' }, false))
    expect(response.status).toBe(401)
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('accepts job ids and returns 202', async () => {
    const response = await handleJobWakeRequest(
      request({ workspaceKey: 'inst_a', jobIds: ['job_01aaaaaaaaaaaaaaaaaaaaaaaa'] })
    )
    expect(response.status).toBe(202)
    expect(mocks.handle).toHaveBeenCalledWith({
      workspaceKey: 'inst_a',
      jobIds: ['job_01aaaaaaaaaaaaaaaaaaaaaaaa'],
      abort: undefined,
    })
  })

  it('forwards an abort payload', async () => {
    const response = await handleJobWakeRequest(
      request({
        workspaceKey: 'inst_a',
        abort: { team: 'T1', channel: 'C1', thread: '1.2' },
      })
    )
    expect(response.status).toBe(202)
    expect(mocks.handle).toHaveBeenCalledWith(
      expect.objectContaining({ abort: { team: 'T1', channel: 'C1', thread: '1.2' } })
    )
  })

  it('refuses a body over 16 KB, bad JSON and a short workspace key without touching the worker (JOB-02)', async () => {
    mocks.authorize.mockReturnValue(true)
    const big = JSON.stringify({ workspaceKey: 'inst_a', pad: 'x'.repeat(17 * 1024) })
    const oversized = await handleJobWakeRequest(
      new Request('http://worker/api/internal/job-wake', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(big)),
        },
        body: big,
      })
    )
    expect(oversized.status).toBe(413)

    const badJson = await handleJobWakeRequest(
      new Request('http://worker/api/internal/job-wake', { method: 'POST', body: '{not json' })
    )
    expect(badJson.status).toBe(400)

    const shortKey = await handleJobWakeRequest(request({ workspaceKey: 'ab' }))
    expect(shortKey.status).toBe(400)
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('returns 503 when this process is not running workers', async () => {
    mocks.running.mockReturnValue(false)
    const response = await handleJobWakeRequest(request({ workspaceKey: 'inst_a' }))
    expect(response.status).toBe(503)
    expect(mocks.handle).not.toHaveBeenCalled()
  })
})
