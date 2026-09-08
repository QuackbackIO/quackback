import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  handle: vi.fn(),
}))

vi.mock('@/lib/server/fleet/internal-auth', () => ({
  authorizeFleetInternal: mocks.authorize,
}))
vi.mock('@/lib/server/jobs/worker', () => ({
  handleJobWake: mocks.handle,
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
})
