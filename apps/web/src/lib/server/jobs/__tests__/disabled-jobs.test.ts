/**
 * `QUACKBACK_DISABLED_JOBS`: an operator pauses a named job.
 *
 * A paused schedule writes nothing. A paused queue's rows stay `pending` with
 * no attempt spent, on every claim path (the poll and start-by-id), and they run
 * once the name is taken off the list. A paused queue's rows and its schedule's
 * deadline never wake a parked workspace.
 *
 * Real Postgres, real commits, unique queue names.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupQueues, closeHarness, rowsFor, testDb, uniqueQueue } from './harness'

vi.mock('@/lib/server/db', () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const handle = testDb()
        const value = Reflect.get(handle as object, prop, handle)
        return typeof value === 'function' ? value.bind(handle) : value
      },
    }
  ),
}))

const { logLines, stubLogger } = vi.hoisted(() => {
  const logLines: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = []
  const capture = (level: string) => (fields: object | string, msg?: string) => {
    if (typeof fields === 'string') logLines.push({ level, msg: fields, fields: {} })
    else logLines.push({ level, msg: msg ?? '', fields: fields as Record<string, unknown> })
  }
  const stubLogger = {
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    debug: capture('debug'),
    child() {
      return stubLogger
    },
  }
  return { logLines, stubLogger }
})
vi.mock('@/lib/server/logger', () => ({ logger: stubLogger }))
vi.mock('@/lib/server/workspaces/workspace-context', () => ({ getCurrentWorkspace: () => null }))

import {
  __setJobDefinitionsForTests,
  JOB_DEFINITIONS,
  logPausedJobs,
  parseDisabledJobs,
  runnableQueues,
} from '../definitions'
import {
  __resetWorkspaceDeadlinesForTests,
  earliestWorkspaceDeadline,
  registerWorkspaceDeadline,
} from '../deadlines'
import { earliestPendingJobAt, enqueueJob, nextPendingJobAt } from '../job-queue'
import {
  awaitPool,
  claimSpecsFor,
  createJobPool,
  createScheduleState,
  drainOnce,
  resetJobHandlers,
  runScheduleTick,
  runnerConfig,
  startJobsById,
  runJob,
} from '../runner'

const created: string[] = []
function queue(label: string): string {
  const q = uniqueQueue(label)
  created.push(q)
  return q
}

const CONFIG = { ...runnerConfig(), batchSize: 10 }
const ENV = 'QUACKBACK_DISABLED_JOBS'

function pause(...names: string[]): void {
  process.env[ENV] = names.join(',')
}

afterEach(() => {
  delete process.env[ENV]
  __setJobDefinitionsForTests(null)
  __resetWorkspaceDeadlinesForTests()
  resetJobHandlers()
  logLines.length = 0
})

afterAll(async () => {
  await cleanupQueues(created)
  await closeHarness()
})

describe('parseDisabledJobs', () => {
  it('reads a comma list of known names and reports the rest', () => {
    const parsed = parseDisabledJobs(
      ' spam-retention, ,file-retention,spam-retention,no-such-job ',
      ['spam-retention', 'file-retention', 'analytics']
    )
    expect([...parsed.paused].sort()).toEqual(['file-retention', 'spam-retention'])
    expect(parsed.unknown).toEqual(['no-such-job'])
  })

  it('pauses nothing when unset or empty', () => {
    expect(parseDisabledJobs(undefined, ['analytics']).paused.size).toBe(0)
    expect(parseDisabledJobs('', ['analytics']).paused.size).toBe(0)
  })
})

describe('the paused log', () => {
  it('names each paused job at worker start and warns about an unknown name', () => {
    const a = queue('log-a')
    const b = queue('log-b')
    __setJobDefinitionsForTests([
      { name: a, handler: async () => async () => {} },
      { name: b, handler: async () => async () => {} },
    ])
    pause(a, 'not-a-job')

    // Reading the list logs nothing; the worker start does, once.
    expect(runnableQueues()).toEqual([b])
    expect(logLines).toHaveLength(0)
    logPausedJobs()

    const paused = logLines.filter((l) => l.msg === 'job paused')
    expect(paused).toHaveLength(1)
    expect(paused[0].fields.queue).toBe(a)
    const unknown = logLines.filter((l) => l.level === 'warn')
    expect(unknown).toHaveLength(1)
    expect(unknown[0].fields.unknown).toEqual(['not-a-job'])
  })
})

describe('a paused schedule', () => {
  it('writes no row, and writes the next slot once the name is removed', async () => {
    const q = queue('sched')
    __setJobDefinitionsForTests([
      { name: q, cron: '* * * * *', handler: async () => async () => {} },
    ])
    const state = createScheduleState()
    const t0 = new Date('2030-01-01T10:00:30Z')
    await runScheduleTick(state, t0)

    pause(q)
    await runScheduleTick(state, new Date('2030-01-01T10:01:30Z'))
    expect(await rowsFor(q)).toHaveLength(0)

    delete process.env[ENV]
    await runScheduleTick(state, new Date('2030-01-01T10:02:30Z'))
    expect(await rowsFor(q)).toHaveLength(1)
  })
})

describe('a paused queue', () => {
  it('keeps its rows pending with no attempt spent, and drains them once removed', async () => {
    const q = queue('claim')
    const ran: string[] = []
    __setJobDefinitionsForTests([
      {
        name: q,
        concurrency: 5,
        handler: async () => async (job) => {
          ran.push(job.jobId)
        },
      },
    ])
    await enqueueJob({ queue: q })
    await enqueueJob({ queue: q })

    pause(q)
    expect(claimSpecsFor(createJobPool(), CONFIG).some((s) => s.queue === q)).toBe(false)
    const paused = await drainOnce(CONFIG)
    expect(paused.claimed).toBe(0)
    const rows = await rowsFor(q)
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ])

    delete process.env[ENV]
    const drained = await drainOnce(CONFIG)
    expect(drained.succeeded).toBe(2)
    expect(ran).toHaveLength(2)
  })

  it('is not claimed by start-by-id either, the path a job wake takes', async () => {
    const q = queue('wake')
    __setJobDefinitionsForTests([{ name: q, handler: async () => async () => {} }])
    const { jobId } = await enqueueJob({ queue: q })

    pause(q)
    const pool = createJobPool()
    const claimed = await startJobsById({ pool, config: CONFIG, jobIds: [jobId], run: runJob })
    expect(claimed).toBe(0)
    expect((await rowsFor(q))[0]).toMatchObject({ status: 'pending', attempts: 0 })

    delete process.env[ENV]
    const started = await startJobsById({ pool, config: CONFIG, jobIds: [jobId], run: runJob })
    await awaitPool(pool)
    expect(started).toBe(1)
    expect((await rowsFor(q))[0].status).toBe('succeeded')
  })

  it('ignores an unknown name and keeps claiming', async () => {
    const q = queue('unknown')
    __setJobDefinitionsForTests([{ name: q, handler: async () => async () => {} }])
    await enqueueJob({ queue: q })
    pause('no-such-job')

    const drained = await drainOnce(CONFIG)
    expect(drained.succeeded).toBe(1)
  })

  it('honours the switch for each job this area adds', () => {
    const names = ['startup-backfill', 'ticket-frt-reconcile', 'deferred-index-build']
    for (const name of names) {
      expect(JOB_DEFINITIONS.some((d) => d.name === name)).toBe(true)
      __setJobDefinitionsForTests(JOB_DEFINITIONS)
      pause(name)
      const specs = claimSpecsFor(createJobPool(), { ...CONFIG, maxConcurrency: 512 })
      expect(specs.some((s) => s.queue === name)).toBe(false)
      delete process.env[ENV]
      const open = claimSpecsFor(createJobPool(), { ...CONFIG, maxConcurrency: 512 })
      expect(open.some((s) => s.queue === name)).toBe(true)
    }
  })
})

describe('the wake time of a parked workspace', () => {
  it('leaves out the pending rows of a paused queue', async () => {
    const q = queue('wake-at')
    __setJobDefinitionsForTests([{ name: q, handler: async () => async () => {} }])
    // Older than anything another suite writes, so it is the minimum when counted.
    const due = new Date('2001-02-03T04:05:06.789Z')
    await enqueueJob({ queue: q, runAt: due })

    expect((await earliestPendingJobAt())?.getTime()).toBe(due.getTime())
    pause(q)
    expect((await earliestPendingJobAt())?.getTime()).not.toBe(due.getTime())
  })

  it('leaves out the delayed rows of a paused queue from the idle sleep', async () => {
    const q = queue('next-at')
    __setJobDefinitionsForTests([{ name: q, handler: async () => async () => {} }])
    const later = new Date(Date.now() + 2_000)
    await enqueueJob({ queue: q, runAt: later })

    expect((await nextPendingJobAt())?.getTime()).toBe(later.getTime())
    pause(q)
    expect((await nextPendingJobAt())?.getTime()).not.toBe(later.getTime())
  })

  it('leaves out the deadline of a paused schedule', async () => {
    const q = queue('deadline')
    __setJobDefinitionsForTests([
      { name: q, cron: '* * * * *', handler: async () => async () => {} },
    ])
    const at = new Date('2030-06-01T12:00:10Z')
    registerWorkspaceDeadline(q, async () => at)
    const now = new Date('2030-06-01T11:00:00Z').getTime()

    expect(await earliestWorkspaceDeadline(now)).toEqual(new Date('2030-06-01T12:01:00Z'))
    pause(q)
    expect(await earliestWorkspaceDeadline(now)).toBeNull()
  })
})
