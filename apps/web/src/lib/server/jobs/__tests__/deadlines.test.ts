/**
 * The deadline gate, and the two ways it can be wrong.
 *
 * It gates `* * * * *` on two sweeps, so it carries the whole risk of that
 * change: too lazy and an SLA breach goes unnoticed, which is worse than the
 * no-op ticks it saves. Both directions are asserted here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTenantDeadlinesForTests,
  dueWithin,
  queueDeadline,
  registerTenantDeadline,
} from '../deadlines'

afterEach(() => __resetTenantDeadlinesForTests())

const at = (iso: string) => new Date(iso)

describe('the cron gate', () => {
  it('lets an unregistered queue keep its cron exactly as written', async () => {
    // The property every OTHER queue in `definitions.ts` depends on: adding this
    // mechanism must not have quietly gated `anon-sweep` or `analytics`.
    expect(await dueWithin('never-registered', 60_000)).toBe(true)
    expect(await queueDeadline('never-registered')).toBeUndefined()
  })

  it('suppresses a tick only when nothing is due inside the slot', async () => {
    const now = at('2026-08-10T12:00:00.000Z').getTime()
    registerTenantDeadline('q', async () => at('2026-08-10T12:00:30.000Z'))
    expect(await dueWithin('q', 60_000, now)).toBe(true)

    __resetTenantDeadlinesForTests()
    registerTenantDeadline('q', async () => at('2026-08-10T12:05:00.000Z'))
    expect(await dueWithin('q', 60_000, now)).toBe(false)
  })

  it('runs a queue whose deadline has already passed', async () => {
    const now = at('2026-08-10T12:00:00.000Z').getTime()
    registerTenantDeadline('q', async () => at('2026-08-10T11:00:00.000Z'))
    expect(await dueWithin('q', 60_000, now)).toBe(true)
  })

  it('treats a provider that throws as due now, never as nothing to do', async () => {
    // The asymmetry that matters: a broken provider must cost a wasted tick, not
    // a breach nobody records.
    registerTenantDeadline('q', async () => {
      throw new Error('index missing')
    })
    expect(await dueWithin('q', 60_000)).toBe(true)
  })

  it('reports nothing due when a tenant has no clock running', async () => {
    registerTenantDeadline('q', async () => null)
    expect(await dueWithin('q', 60_000)).toBe(false)
  })
})

/**
 * The slot memory a shut gate must not lose.
 *
 * `runScheduleTick` drops the remembered slot of any schedule it did not see
 * this pass, so that a deleted segment or an unconfigured mailbox does not leak
 * one forever. A gate that says "not due" used to look identical to that — and
 * the first pass after it reopened adopted the current slot without running it,
 * because a schedule with no memory is a schedule that has never run.
 *
 * Harmless while a gate flipped for a minute at a time. Fatal once a gate can
 * stay shut for hours: measured against a real tenant, a snooze due in ninety
 * seconds was never swept at all, because every wake was a first pass.
 */
describe('a gated-off schedule keeps its slot memory', () => {
  it('runs on the first slot after the gate opens, rather than adopting it', async () => {
    vi.resetModules()
    let due = false
    const enqueued: string[] = []
    vi.doMock('../job-queue', () => ({
      enqueueJob: async (input: { queue: string }) => {
        enqueued.push(input.queue)
        return { jobId: 'job_x', inserted: true }
      },
      isMissingJobQueue: () => false,
    }))
    vi.doMock('../definitions', async (importOriginal) => {
      const actual = await importOriginal<Record<string, unknown>>()
      const only = [
        {
          name: 'gated',
          cron: '* * * * *',
          handler: async () => async () => {},
          cronEnabled: async () => due,
        },
      ]
      return { ...actual, JOB_DEFINITIONS: only, jobDefinitions: () => only }
    })
    const runner = await import('../runner')
    const state = runner.createScheduleState()

    // Shut. Nothing is enqueued — and nothing is forgotten either.
    await runner.runScheduleTick(state, at('2026-08-10T12:00:00.000Z'))
    await runner.runScheduleTick(state, at('2026-08-10T12:01:00.000Z'))
    expect(enqueued).toEqual([])

    // Open. 12:02 is a new slot relative to the 12:01 the shut gate still
    // remembers, so it runs. Without that memory this reads as a first pass and
    // adopts 12:02 in silence.
    due = true
    await runner.runScheduleTick(state, at('2026-08-10T12:02:00.000Z'))
    expect(enqueued).toEqual(['gated'])
    vi.resetModules()
  })
})
