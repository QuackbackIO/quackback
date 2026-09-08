import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('job-wake publisher', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    delete process.env.QUACKBACK_JOB_WORKER_URL
    delete process.env.QUACKBACK_FLEET_INTERNAL_TOKEN
    process.env.QUACKBACK_ROLE = 'web'
  })

  afterEach(async () => {
    const { __resetJobWakePublisherForTests } = await import('../wake')
    __resetJobWakePublisherForTests()
    const { __resetAfterCommitForTests } = await import('@/lib/server/workspaces/after-commit')
    __resetAfterCommitForTests()
    delete process.env.QUACKBACK_ROLE
    delete process.env.QUACKBACK_JOB_WORKER_URL
    delete process.env.QUACKBACK_FLEET_INTERNAL_TOKEN
    vi.useRealTimers()
  })

  it('does not subscribe when ROLE is not web', async () => {
    process.env.QUACKBACK_ROLE = 'all'
    process.env.QUACKBACK_JOB_WORKER_URL = 'http://worker:3000'
    process.env.QUACKBACK_FLEET_INTERNAL_TOKEN = 'token'
    const { startJobWakePublisher } = await import('../wake')
    const { noteDurableWork } = await import('@/lib/server/workspaces/after-commit')
    startJobWakePublisher()
    noteDurableWork('inst_a', { jobId: 'job_01aaaaaaaaaaaaaaaaaaaaaaaa' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs workspace key and job ids after commit, coalesced', async () => {
    vi.useFakeTimers()
    process.env.QUACKBACK_JOB_WORKER_URL = 'http://worker.railway.internal:3000'
    process.env.QUACKBACK_FLEET_INTERNAL_TOKEN = 'fleet-token'
    const { startJobWakePublisher } = await import('../wake')
    const { noteDurableWork } = await import('@/lib/server/workspaces/after-commit')
    startJobWakePublisher()
    noteDurableWork('inst_a', { jobId: 'job_01aaaaaaaaaaaaaaaaaaaaaaaa' })
    noteDurableWork('inst_a', { jobId: 'job_01bbbbbbbbbbbbbbbbbbbbbbbb' })
    await vi.advanceTimersByTimeAsync(15)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://worker.railway.internal:3000/api/internal/job-wake')
    expect(init.headers).toMatchObject({ authorization: 'Bearer fleet-token' })
    const body = JSON.parse(String(init.body)) as { workspaceKey: string; jobIds: string[] }
    expect(body.workspaceKey).toBe('inst_a')
    expect(body.jobIds.sort()).toEqual([
      'job_01aaaaaaaaaaaaaaaaaaaaaaaa',
      'job_01bbbbbbbbbbbbbbbbbbbbbbbb',
    ])
  })
})
