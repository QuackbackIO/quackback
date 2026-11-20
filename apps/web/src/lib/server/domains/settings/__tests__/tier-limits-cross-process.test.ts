/**
 * A plan written by another process reaches this one within seconds.
 *
 * A projection or tier-limits write drops this process's copy of the plan at
 * once, but only in the process that wrote it. Every other web process and the
 * worker hold their copy for a short window and then read the row again, the
 * same window the workspace settings copies use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const row = vi.hoisted(() => ({ tierLimits: null as string | null, reads: 0 }))

vi.mock('@/lib/server/db', () => ({
  settings: { tierLimits: 'tier_limits', cloud: 'cloud' },
  db: {
    select: () => ({
      from: () => ({
        limit: async () => {
          row.reads += 1
          return [{ tierLimits: row.tierLimits, cloud: null }]
        },
      }),
    }),
  },
}))

const { getTierLimits, invalidateTierLimitsCache } = await import('../tier-limits.service')
const { SETTINGS_LOCAL_TTL_MS } = await import('@/lib/server/local-cache')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
  row.tierLimits = JSON.stringify({ maxBoards: 3 })
  row.reads = 0
  invalidateTierLimitsCache()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('tier limits written by another process', () => {
  it('are served from this process’s copy inside the window', async () => {
    expect((await getTierLimits()).maxBoards).toBe(3)
    row.tierLimits = JSON.stringify({ maxBoards: 99 })
    vi.advanceTimersByTime(SETTINGS_LOCAL_TTL_MS - 1)
    expect((await getTierLimits()).maxBoards).toBe(3)
    expect(row.reads).toBe(1)
  })

  it('are read again once the window has passed', async () => {
    expect((await getTierLimits()).maxBoards).toBe(3)
    // Written elsewhere: nothing here is invalidated.
    row.tierLimits = JSON.stringify({ maxBoards: 99 })
    vi.advanceTimersByTime(SETTINGS_LOCAL_TTL_MS + 1)
    expect((await getTierLimits()).maxBoards).toBe(99)
  })
})
