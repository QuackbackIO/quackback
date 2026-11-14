/**
 * A jittered call that a burst of triggers runs once, and that unmounting
 * cancels: the inbox's refetch after a scope change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coalescedJitter } from '../coalesced-jitter'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('coalescedJitter', () => {
  it('runs once after a burst of triggers, within the jitter window', () => {
    const run = vi.fn()
    const call = coalescedJitter(run, 2_000, () => 0.5)
    call.schedule()
    call.schedule()
    call.schedule()
    vi.advanceTimersByTime(999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('schedules again once the pending run has gone', () => {
    const run = vi.fn()
    const call = coalescedJitter(run, 2_000, () => 0)
    call.schedule()
    vi.advanceTimersByTime(0)
    call.schedule()
    vi.advanceTimersByTime(0)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never runs once cancelled', () => {
    const run = vi.fn()
    const call = coalescedJitter(run, 2_000, () => 0.5)
    call.schedule()
    call.cancel()
    vi.advanceTimersByTime(5_000)
    expect(run).not.toHaveBeenCalled()
  })
})
