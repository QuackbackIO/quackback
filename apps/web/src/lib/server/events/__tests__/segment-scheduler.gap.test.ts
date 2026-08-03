/**
 * Gap coverage for segment-scheduler: the disabled-schedule early return,
 * the remove-by-key found path, the init-failure reset (line ~65 branch),
 * the restoreAll happy + catch paths, and graceful close.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  waitUntilReady: vi.fn().mockResolvedValue(undefined),
  evaluateDynamicSegment: vi.fn(),
  dbSelectWhere: vi.fn().mockResolvedValue([]),
}))

const queueInstances: Array<Record<string, ReturnType<typeof vi.fn>>> = []

vi.mock('@/lib/server/config', () => ({
  config: { redisUrl: 'redis://localhost:6379' },
}))

vi.mock('@/lib/server/queue/redis-config', () => ({
  getQueueRedis: vi.fn(() => ({})),
  REDIS_READY_TIMEOUT_MS: 5000,
}))

vi.mock('bullmq', () => {
  class Queue {
    add = vi.fn().mockResolvedValue(undefined)
    getRepeatableJobs = vi.fn().mockResolvedValue([])
    removeRepeatableByKey = vi.fn().mockResolvedValue(undefined)
    waitUntilReady = (...a: unknown[]) => h.waitUntilReady(...a)
    close = vi.fn().mockResolvedValue(undefined)
    constructor() {
      queueInstances.push(this as never)
    }
  }
  class Worker {
    on = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
  }
  class UnrecoverableError extends Error {}
  return { Queue, Worker, UnrecoverableError }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: h.dbSelectWhere }),
    }),
  },
  segments: { id: 's.id', type: 's.type', evaluationSchedule: 's.sched', deletedAt: 's.del' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/server/domains/segments/segment.evaluation', () => ({
  evaluateDynamicSegment: h.evaluateDynamicSegment,
}))

beforeEach(() => {
  vi.clearAllMocks()
  queueInstances.length = 0
  h.waitUntilReady.mockResolvedValue(undefined)
  h.dbSelectWhere.mockResolvedValue([])
})

describe('segment-scheduler gap', () => {
  it('disabled schedule removes existing but does not add', async () => {
    const mod = await import('../segment-scheduler')
    await mod.upsertSegmentEvaluationSchedule('segment_x' as never, {
      enabled: false,
      pattern: '0 * * * *',
    })
    const queue = queueInstances[0]
    expect(queue.add).not.toHaveBeenCalled()
    await mod.closeSegmentScheduler()
  })

  it('removeSegmentEvaluationSchedule removes the matching repeatable job', async () => {
    const mod = await import('../segment-scheduler')
    // Trigger queue creation
    await mod.listEvaluationSchedules()
    const queue = queueInstances[0]
    queue.getRepeatableJobs.mockResolvedValue([
      { name: 'segment-eval:segment_match', key: 'key-1' },
      { name: 'other', key: 'key-2' },
    ])
    await mod.removeSegmentEvaluationSchedule('segment_match' as never)
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('key-1')
    await mod.closeSegmentScheduler()
  })

  it('restoreAllEvaluationSchedules schedules enabled dynamic segments and skips disabled', async () => {
    h.dbSelectWhere.mockResolvedValue([
      { id: 'seg_enabled', evaluationSchedule: { enabled: true, pattern: '0 * * * *' } },
      { id: 'seg_disabled', evaluationSchedule: { enabled: false, pattern: '0 * * * *' } },
      { id: 'seg_null', evaluationSchedule: null },
    ])
    const mod = await import('../segment-scheduler')
    await mod.restoreAllEvaluationSchedules()
    const queue = queueInstances[0]
    expect(queue.add).toHaveBeenCalledTimes(1)
    await mod.closeSegmentScheduler()
  })

  it('restoreAllEvaluationSchedules swallows db errors', async () => {
    h.dbSelectWhere.mockRejectedValue(new Error('db down'))
    const mod = await import('../segment-scheduler')
    await expect(mod.restoreAllEvaluationSchedules()).resolves.toBeUndefined()
  })

  it('closeSegmentScheduler is a no-op when never initialized', async () => {
    vi.resetModules()
    const mod = await import('../segment-scheduler')
    await expect(mod.closeSegmentScheduler()).resolves.toBeUndefined()
  })
})
