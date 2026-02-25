import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueInstances: Array<{
  add: ReturnType<typeof vi.fn>
  getRepeatableJobs: ReturnType<typeof vi.fn>
  removeRepeatableByKey: ReturnType<typeof vi.fn>
  waitUntilReady: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}> = []

vi.mock('@/lib/server/config', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
  },
}))

vi.mock('bullmq', () => {
  class Queue {
    add = vi.fn().mockResolvedValue(undefined)
    getRepeatableJobs = vi.fn().mockResolvedValue([])
    removeRepeatableByKey = vi.fn().mockResolvedValue(undefined)
    waitUntilReady = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)

    constructor() {
      queueInstances.push(this)
    }
  }

  class Worker {
    on = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
  }

  class UnrecoverableError extends Error {}

  return { Queue, Worker, UnrecoverableError }
})

describe('segment-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueInstances.length = 0
  })

  it('schedules a repeatable job when enabled', async () => {
    const { upsertSegmentEvaluationSchedule, closeSegmentScheduler } =
      await import('../segment-scheduler')
    await upsertSegmentEvaluationSchedule('segment_abc' as never, {
      enabled: true,
      pattern: '0 * * * *',
    })

    const queue = queueInstances[0]
    expect(queue?.add).toHaveBeenCalledWith(
      'segment-eval:segment_abc',
      { segmentId: 'segment_abc' },
      {
        repeat: { pattern: '0 * * * *' },
        jobId: 'segment-eval:segment_abc',
      }
    )

    await closeSegmentScheduler()
  })

  it('lists only segment evaluation repeatable jobs', async () => {
    const { listEvaluationSchedules, closeSegmentScheduler } = await import('../segment-scheduler')
    await listEvaluationSchedules()

    const queue = queueInstances[0]
    queue.getRepeatableJobs.mockResolvedValue([
      { name: 'segment-eval:segment_one', pattern: '*/5 * * * *', next: 123 },
      { name: 'other-job', pattern: '* * * * *', next: 456 },
    ])

    const result = await listEvaluationSchedules()
    expect(result).toEqual([{ segmentId: 'segment_one', pattern: '*/5 * * * *', next: 123 }])

    await closeSegmentScheduler()
  })
})
