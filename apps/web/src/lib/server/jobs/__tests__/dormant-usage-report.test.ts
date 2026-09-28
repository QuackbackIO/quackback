import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DORMANT_REPORT_RETRY_MS,
  catchUpDormantUsageReports,
  resetDormantUsageReportState,
  type DormantUsageReportDeps,
} from '../dormant-usage-report'

const SEP = new Date('2026-09-28T19:00:00Z')

function deps(o: Partial<DormantUsageReportDeps> = {}) {
  let now = SEP
  const d: DormantUsageReportDeps & { setNow: (at: Date) => void } = {
    hosted: () => true,
    now: () => now,
    dormant: () => ['ws_a', 'ws_b'],
    enqueueIn: vi.fn(async (key: string) => ({ inserted: key === 'ws_a' })),
    wake: vi.fn(async () => {}),
    warn: vi.fn(),
    setNow: (at) => {
      now = at
    },
    ...o,
  }
  return d
}

beforeEach(() => resetDormantUsageReportState())

describe('catchUpDormantUsageReports', () => {
  it('queues last month for each parked workspace and wakes only the ones that had not reported', async () => {
    const d = deps()
    expect(await catchUpDormantUsageReports(d)).toEqual({ queued: 1, checked: 2 })
    expect(d.enqueueIn).toHaveBeenCalledWith('ws_a', '2026-08')
    expect(d.enqueueIn).toHaveBeenCalledWith('ws_b', '2026-08')
    expect(d.wake).toHaveBeenCalledTimes(1)
    expect(d.wake).toHaveBeenCalledWith('ws_a')
  })

  it('asks each workspace once a month', async () => {
    const d = deps()
    await catchUpDormantUsageReports(d)
    expect(await catchUpDormantUsageReports(d)).toEqual({ queued: 0, checked: 0 })
    d.setNow(new Date('2026-10-01T00:05:00Z'))
    await catchUpDormantUsageReports(d)
    expect(d.enqueueIn).toHaveBeenLastCalledWith('ws_b', '2026-09')
  })

  it('retries a workspace whose scope failed, but no more than hourly', async () => {
    const d = deps({
      dormant: () => ['ws_a'],
      enqueueIn: vi.fn(async () => {
        throw new Error('scope refused')
      }),
    })
    await catchUpDormantUsageReports(d)
    expect(d.warn).toHaveBeenCalledTimes(1)
    expect((await catchUpDormantUsageReports(d)).checked).toBe(0)
    d.setNow(new Date(SEP.getTime() + DORMANT_REPORT_RETRY_MS + 1))
    expect((await catchUpDormantUsageReports(d)).checked).toBe(1)
  })

  it('starts over for a workspace that woke and was parked again', async () => {
    const parked = { list: ['ws_a'] }
    const d = deps({ dormant: () => parked.list })
    await catchUpDormantUsageReports(d)
    parked.list = []
    await catchUpDormantUsageReports(d)
    parked.list = ['ws_a']
    expect((await catchUpDormantUsageReports(d)).checked).toBe(1)
  })

  it('does nothing on self-host', async () => {
    const d = deps({ hosted: () => false })
    expect(await catchUpDormantUsageReports(d)).toEqual({ queued: 0, checked: 0 })
    expect(d.enqueueIn).not.toHaveBeenCalled()
  })
})
