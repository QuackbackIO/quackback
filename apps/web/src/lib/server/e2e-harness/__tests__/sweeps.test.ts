/**
 * The sweep runner's allow-list and clock handling. The sweeps themselves are
 * doubles that record the instant they were given, so a runner that dropped
 * `asOf` (or passed the wall clock) fails here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ job: string; at?: Date }> = []

vi.mock('@/lib/server/db', () => ({ db: { execute: vi.fn() } }))
vi.mock('@/lib/server/domains/sla/sla-breach-sweep-queue', () => ({
  runSlaBreachSweepAt: vi.fn(async (at: Date) => {
    calls.push({ job: 'sla-breach-sweep', at })
    return { recorded: 1, ticketRecorded: 0 }
  }),
}))
vi.mock('@/lib/server/domains/conversation/snooze-sweep-queue', () => ({
  runSnoozeSweepAt: vi.fn(async (at: Date) => {
    calls.push({ job: 'snooze-sweep', at })
    return { woken: 2 }
  }),
}))
vi.mock('@/lib/server/domains/workflows/workflow-sweep-queue', () => ({
  runWorkflowSweepAt: vi.fn(async (at: Date) => {
    calls.push({ job: 'workflow-sweep', at })
  }),
}))
vi.mock('@/lib/server/email/email-log.retention', () => ({
  runEmailLogRetention: vi.fn(async () => {
    calls.push({ job: 'email-log-retention' })
  }),
}))

import { E2E_SWEEP_NAMES, runE2eSweep } from '../sweeps'

beforeEach(() => {
  calls.length = 0
})

describe('runE2eSweep', () => {
  it('passes asOf through to the sweep as its clock', async () => {
    const outcome = await runE2eSweep({ job: 'snooze-sweep', asOf: '2030-05-01T10:00:00.000Z' })
    expect(outcome).toEqual({
      ok: true,
      job: 'snooze-sweep',
      asOf: '2030-05-01T10:00:00.000Z',
      result: { woken: 2 },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].at?.toISOString()).toBe('2030-05-01T10:00:00.000Z')
  })

  it('uses the wall clock when no asOf is given', async () => {
    const before = Date.now()
    await runE2eSweep({ job: 'sla-breach-sweep' })
    const at = calls[0].at!.getTime()
    expect(at).toBeGreaterThanOrEqual(before)
    expect(at).toBeLessThanOrEqual(Date.now())
  })

  it('refuses a name outside the allow-list without running anything', async () => {
    for (const job of ['import', 'export', 'events', '__proto__', 'constructor', '']) {
      const outcome = await runE2eSweep({ job })
      expect(outcome, job).toMatchObject({ ok: false, status: 400 })
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses asOf for a sweep that cannot honour it', async () => {
    const outcome = await runE2eSweep({ job: 'email-log-retention', asOf: '2030-01-01T00:00:00Z' })
    expect(outcome).toMatchObject({ ok: false, status: 400 })
    expect(calls).toHaveLength(0)
  })

  it('refuses an unreadable asOf', async () => {
    const outcome = await runE2eSweep({ job: 'workflow-sweep', asOf: 'next tuesday' })
    expect(outcome).toMatchObject({ ok: false, status: 400 })
    expect(calls).toHaveLength(0)
  })

  it('runs a wall-clock-only sweep when no asOf is sent', async () => {
    const outcome = await runE2eSweep({ job: 'email-log-retention' })
    expect(outcome).toMatchObject({ ok: true, job: 'email-log-retention' })
    expect(calls).toEqual([{ job: 'email-log-retention' }])
  })

  it('lists the sweeps it accepts and never the one-shot queues', () => {
    expect(E2E_SWEEP_NAMES).toContain('sla-breach-sweep')
    expect(E2E_SWEEP_NAMES).toContain('snooze-sweep')
    expect(E2E_SWEEP_NAMES).toContain('workflow-sweep')
    expect(E2E_SWEEP_NAMES).toContain('workflow-wait')
    expect(E2E_SWEEP_NAMES).not.toContain('import')
    expect(E2E_SWEEP_NAMES).not.toContain('export')
  })
})
