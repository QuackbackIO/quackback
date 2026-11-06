/**
 * A parked workspace's loop is running before the cron slot that spends its
 * clock-driven work, so the work runs by its deadline.
 *
 * The chain is driven on a simulated clock with the real pieces: the deadline
 * provider and its minute rounding (`earliestWorkspaceDeadline`), the wake rule
 * the worker applies on each refresh pass (`withinWakeLead`), and the schedule tick
 * a new loop runs (`runScheduleTick`). A loop's first tick adopts the slot it
 * starts in instead of running it, and a slot starts `scheduleOffsetMs` after its
 * minute, so a loop woken late misses the slot that handles the work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  now: 0,
  enqueued: [] as Array<{ at: number; scheduledFor: string }>,
}))

vi.mock('../job-queue', () => ({
  enqueueJob: async (args: { payload: { scheduledFor: string } }) => {
    probe.enqueued.push({ at: probe.now, scheduledFor: args.payload.scheduledFor })
    return { inserted: true }
  },
}))

import { __setJobDefinitionsForTests } from '../definitions'
import {
  __resetWorkspaceDeadlinesForTests,
  clockWakeLeadMs,
  dueWithin,
  earliestWorkspaceDeadline,
  registerWorkspaceDeadline,
  withinWakeLead,
} from '../deadlines'
import { createScheduleState, runScheduleTick, scheduleOffsetMs } from '../runner'

const QUEUE = 'wake-probe'
const PER_MINUTE = '* * * * *'
const MINUTE_MS = 60_000
/** The pooled worker's refresh interval (`WORKSPACE_REFRESH_MS` in worker.ts). */
const REFRESH_MS = 60_000
/** A deadline at 14:05:00, and the slot that must spend it. */
const DUE_MS = Date.parse('2026-08-10T14:05:00.000Z')
const SLOT_BEFORE_DUE = '2026-08-10T14:04:00.000Z'

beforeEach(() => {
  probe.enqueued.length = 0
  __resetWorkspaceDeadlinesForTests()
  registerWorkspaceDeadline(QUEUE, async () => new Date(DUE_MS))
  __setJobDefinitionsForTests([
    {
      name: QUEUE,
      cron: PER_MINUTE,
      cronEnabled: () => dueWithin(QUEUE, MINUTE_MS, probe.now),
      handler: async () => async () => {},
    },
  ])
})

afterEach(() => {
  __resetWorkspaceDeadlinesForTests()
  __setJobDefinitionsForTests(null)
})

/** One key per 15 seconds of the per-minute spread, so every offset bucket is covered. */
function keysBySpreadBucket(): Map<number, string> {
  const picked = new Map<number, string>()
  for (let i = 0; i < 10_000 && picked.size < 4; i++) {
    const key = `ws_wake_probe_${i}`
    const bucket = Math.floor(scheduleOffsetMs(key, PER_MINUTE) / 15_000)
    if (!picked.has(bucket)) picked.set(bucket, key)
  }
  return picked
}

/**
 * A parked workspace, whose refresh passes fall `phaseMs` past each minute, woken by
 * the first pass whose wake rule says its work is due. Its new loop then ticks every
 * second, as the idle loop's poll does, until a slot enqueues.
 */
async function handledBy(spreadKey: string, phaseMs: number) {
  const parkedAt = DUE_MS - 30 * MINUTE_MS
  let pass = parkedAt + phaseMs
  for (;;) {
    probe.now = pass
    const wake = await earliestWorkspaceDeadline(pass)
    if (wake && withinWakeLead(wake.getTime(), pass, clockWakeLeadMs(REFRESH_MS))) break
    pass += REFRESH_MS
  }

  const state = createScheduleState({ spreadKey })
  for (let t = pass; t <= DUE_MS + 2 * MINUTE_MS; t += 1_000) {
    probe.now = t
    const before = probe.enqueued.length
    await runScheduleTick(state, new Date(t))
    if (probe.enqueued.length > before) return probe.enqueued[before]
  }
  return null
}

describe('a parked workspace woken for a deadline', () => {
  it('hands the deadline to the slot before it when its refresh falls after that slot starts', async () => {
    // A workspace whose slots start about 20 seconds into each minute, with refresh
    // passes at 40 seconds past each minute. A pass at 14:05:40 would wake a loop that
    // adopts the 14:05:20 slot, so the 14:04 slot that spends the deadline has to be
    // reached by an earlier pass.
    const key = keysBySpreadBucket().get(1)
    expect(key).toBeDefined()

    const handled = await handledBy(key as string, 40_000)

    expect(handled?.scheduledFor).toBe(SLOT_BEFORE_DUE)
    expect(handled?.at).toBeLessThanOrEqual(DUE_MS)
  })

  it('hands every deadline to the slot before it, whatever the spread offset and refresh phase', async () => {
    const keys = keysBySpreadBucket()
    expect(keys.size).toBe(4)

    const late: unknown[] = []
    for (const key of keys.values()) {
      for (let phaseMs = 0; phaseMs < MINUTE_MS; phaseMs += 5_000) {
        const handled = await handledBy(key, phaseMs)
        if (!handled || handled.scheduledFor !== SLOT_BEFORE_DUE || handled.at > DUE_MS) {
          late.push({ key, phaseMs, handled })
        }
      }
    }
    expect(late).toEqual([])
  })
})
