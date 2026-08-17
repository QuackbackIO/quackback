import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NODE_MAX_TIMEOUT_MS,
  createWorkspaceScheduler,
  recoverPendingWork,
  type SchedulerClock,
} from '../scheduler'

function fakeClock(start = 1_000_000): SchedulerClock & {
  advance: (ms: number) => void
  nowMs: () => number
} {
  let now = start
  let nextId = 1
  const timers = new Map<number, { when: number; fn: () => void }>()

  const clock = {
    now: () => now,
    nowMs: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { when: now + Math.max(0, ms), fn })
      return id
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number)
    },
    advance(ms: number) {
      const target = now + ms
      while (true) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.when <= target)
          .sort((a, b) => a[1].when - b[1].when)
        if (due.length === 0) {
          now = target
          return
        }
        const [id, timer] = due[0]
        timers.delete(id)
        now = timer.when
        timer.fn()
      }
    },
  }
  return clock
}

describe('workspace scheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces repeated signals into one in-flight run', async () => {
    const clock = fakeClock()
    let started = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async () => {
        started += 1
        await gate
        return null
      },
    })
    scheduler.signal('ws_a')
    scheduler.signal('ws_a')
    scheduler.signal('ws_a')
    await Promise.resolve()
    expect(started).toBe(1)
    expect(scheduler.isRunning('ws_a')).toBe(true)
    release()
    await scheduler.idle()
    expect(scheduler.size()).toBe(0)
    scheduler.stop()
  })

  it('replaces a later deadline with an earlier one', async () => {
    const clock = fakeClock()
    const ran: string[] = []
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async (key) => {
        ran.push(key)
        return null
      },
    })
    scheduler.scheduleAt('ws_a', clock.now() + 60_000)
    scheduler.scheduleAt('ws_a', clock.now() + 5_000)
    expect(scheduler.peek()?.wakeAt).toBe(clock.now() + 5_000)
    clock.advance(5_000)
    await scheduler.idle()
    expect(ran).toEqual(['ws_a'])
    scheduler.stop()
  })

  it('a stale timer generation cannot run twice', async () => {
    const clock = fakeClock()
    let runs = 0
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async () => {
        runs += 1
        return null
      },
    })
    scheduler.scheduleAt('ws_a', clock.now() + 10_000)
    scheduler.scheduleAt('ws_a', clock.now() + 1_000)
    clock.advance(10_000)
    await scheduler.idle()
    expect(runs).toBe(1)
    scheduler.stop()
  })

  it('removes a workspace with no deadline from the heap', async () => {
    const clock = fakeClock()
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async () => null,
    })
    scheduler.signal('ws_a')
    await scheduler.idle()
    expect(scheduler.size()).toBe(0)
    expect(scheduler.peek()).toBeNull()
    scheduler.stop()
  })

  it('stores only the next wake time after a pass', async () => {
    const clock = fakeClock()
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async () => new Date(clock.now() + 30_000),
    })
    scheduler.signal('ws_a')
    await scheduler.idle()
    expect(scheduler.size()).toBe(1)
    expect(scheduler.peek()?.wakeAt).toBe(clock.now() + 30_000)
    scheduler.stop()
  })

  it('clamps long deadlines to Node’s timer limit and re-arms', async () => {
    const clock = fakeClock()
    let runs = 0
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async () => {
        runs += 1
        return null
      },
    })
    const far = clock.now() + NODE_MAX_TIMEOUT_MS + 60_000
    scheduler.scheduleAt('ws_a', far)
    clock.advance(NODE_MAX_TIMEOUT_MS)
    expect(runs).toBe(0)
    expect(scheduler.size()).toBe(1)
    clock.advance(60_000)
    await scheduler.idle()
    expect(runs).toBe(1)
    scheduler.stop()
  })

  it('one bad workspace does not block another', async () => {
    const clock = fakeClock()
    const ran: string[] = []
    const scheduler = createWorkspaceScheduler({
      clock,
      maxFanout: 2,
      runWorkspace: async (key) => {
        if (key === 'ws_bad') throw new Error('poison')
        ran.push(key)
        return null
      },
    })
    scheduler.signal('ws_bad')
    scheduler.signal('ws_ok')
    await scheduler.idle()
    expect(ran).toEqual(['ws_ok'])
    expect(scheduler.peek()?.workspaceKey).toBe('ws_bad')
    scheduler.stop()
  })

  it('startup recovery reconstructs immediate work and future deadlines', async () => {
    const clock = fakeClock()
    const ran: string[] = []
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async (key) => {
        ran.push(key)
        if (key === 'ws_later') return new Date(clock.now() + 45_000)
        return null
      },
    })
    await recoverPendingWork(scheduler, async () => ['ws_now', 'ws_later'], 2)
    expect(ran.sort()).toEqual(['ws_later', 'ws_now'])
    expect(scheduler.peek()?.workspaceKey).toBe('ws_later')
    clock.advance(45_000)
    await scheduler.idle()
    expect(ran.filter((k) => k === 'ws_later')).toHaveLength(2)
    scheduler.stop()
  })

  it('due work runs without a later signal', async () => {
    const clock = fakeClock()
    const ran: number[] = []
    const scheduler = createWorkspaceScheduler({
      clock,
      runWorkspace: async () => {
        ran.push(clock.now())
        return null
      },
    })
    scheduler.scheduleAt('ws_a', clock.now() + 12_000)
    clock.advance(12_000)
    await scheduler.idle()
    expect(ran).toEqual([1_012_000])
    scheduler.stop()
  })
})
