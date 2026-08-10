/**
 * The deadline gate, and the two ways it can be wrong.
 *
 * It replaced `* * * * *` on two sweeps, so it carries the whole risk of that
 * change: too eager and the compute never suspends (which is the defect it
 * exists to remove), too lazy and an SLA breach goes unnoticed (which is worse
 * than the defect). Both directions are asserted here.
 *
 * The rounding case is the one that was found by measurement rather than by
 * reading. A tier woken at the exact deadline finds the cron slot bracketing
 * that instant already spent, enqueues nothing, and recomputes a deadline now in
 * the past — a reconnect loop that no enqueue counter can see.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetTenantDeadlinesForTests,
  dueWithin,
  earliestTenantDeadline,
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
    expect(await earliestTenantDeadline()).toBeNull()
  })
})

describe('the wake instant a detaching tier records', () => {
  it('rounds a deadline up to a slot the schedule can actually spend', async () => {
    // 12:00:30 is inside the 12:00 slot, which the tick that ran at 12:00:00
    // already spent. Waking at 12:00:30 would find nothing to enqueue and go
    // straight back to sleep on a deadline now in the past.
    registerTenantDeadline('q', async () => at('2026-08-10T12:00:30.000Z'))
    const wake = await earliestTenantDeadline(at('2026-08-10T12:00:05.000Z').getTime())
    expect(wake?.toISOString()).toBe('2026-08-10T12:01:00.000Z')
  })

  it('never returns an instant in the past, however stale the deadline', async () => {
    registerTenantDeadline('q', async () => at('2026-08-10T09:00:00.000Z'))
    const now = at('2026-08-10T12:00:05.000Z').getTime()
    const wake = await earliestTenantDeadline(now)
    expect(wake!.getTime()).toBeGreaterThan(now)
    expect(wake?.toISOString()).toBe('2026-08-10T12:01:00.000Z')
  })

  it('takes the earliest across every queue, not the first registered', async () => {
    registerTenantDeadline('late', async () => at('2026-08-10T18:00:00.000Z'))
    registerTenantDeadline('early', async () => at('2026-08-10T13:00:00.000Z'))
    registerTenantDeadline('none', async () => null)
    const wake = await earliestTenantDeadline(at('2026-08-10T12:00:00.000Z').getTime())
    expect(wake?.toISOString()).toBe('2026-08-10T13:01:00.000Z')
  })
})
