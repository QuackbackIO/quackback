import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  reportWorkspaceUsage: vi.fn(async (..._args: unknown[]) => {}),
  countSeatUsage: vi.fn(async () => ({ members: 3, pendingInvites: 1, used: 4 })),
  aiTokensInUtcMonth: vi.fn(async () => 1_200_000),
  emailsSentInUtcMonth: vi.fn(async () => 42),
  enqueueJob: vi.fn(async (_opts?: unknown) => ({ inserted: true, jobId: 'job_x' })),
  cancelJob: vi.fn(async (_opts?: unknown) => 0),
  postCount: 8,
  boardCount: 2,
  detectPlanLimitsQuietly: vi.fn(async () => {}),
  planLimitsView: { phase: 'grace', since: '2026-07-30T00:00:00.000Z' } as unknown,
  getPlanLimits: vi.fn(async (): Promise<unknown> => hoisted.planLimitsView),
  sendPlanLimitsEmailsQuietly: vi.fn(async (_view: unknown) => {}),
}))

vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  detectPlanLimitsQuietly: () => hoisted.detectPlanLimitsQuietly(),
  getPlanLimits: () => hoisted.getPlanLimits(),
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.emails', () => ({
  sendPlanLimitsEmailsQuietly: (view: unknown) => hoisted.sendPlanLimitsEmailsQuietly(view),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => [
            { count: table === actual.posts ? hoisted.postCount : hoisted.boardCount },
          ],
        }),
      }),
    },
  }
})

vi.mock('@/lib/server/control-plane/client', () => ({
  reportWorkspaceUsage: (...args: unknown[]) => hoisted.reportWorkspaceUsage(...args),
}))

vi.mock('@/lib/server/domains/principals/seat-usage', () => ({
  countSeatUsage: () => hoisted.countSeatUsage(),
}))

vi.mock('@/lib/server/domains/ai/usage-counter', () => ({
  aiTokensInUtcMonth: () => hoisted.aiTokensInUtcMonth(),
}))

vi.mock('@/lib/server/email/email-budget', () => ({
  emailsSentInUtcMonth: () => hoisted.emailsSentInUtcMonth(),
}))

vi.mock('@/lib/server/jobs/job-queue', () => ({
  enqueueJob: (opts: unknown) => hoisted.enqueueJob(opts),
  cancelJob: (opts: unknown) => hoisted.cancelJob(opts),
}))

import { isHostedBillingConfigured, monthFromJob, runUsageReport } from '../usage-report-queue'
import { previousUtcMonth, usageReportDedupeKey } from '../usage-report'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

function job(payload: Record<string, unknown>, dedupeKey = 'usage-report:2026-07'): ClaimedJob {
  return {
    id: '1',
    jobId: 'job_1',
    queue: 'usage-report',
    dedupeKey,
    payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 10,
    leaseToken: 'tok',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
}

describe('usage-report job', () => {
  const previous = process.env.QUACKBACK_CONTROL_PLANE_URL

  afterEach(() => {
    hoisted.reportWorkspaceUsage.mockClear()
    hoisted.enqueueJob.mockClear()
    hoisted.cancelJob.mockClear()
    hoisted.detectPlanLimitsQuietly.mockClear()
    hoisted.getPlanLimits.mockClear()
    hoisted.sendPlanLimitsEmailsQuietly.mockClear()
    vi.useRealTimers()
    if (previous === undefined) delete process.env.QUACKBACK_CONTROL_PLANE_URL
    else process.env.QUACKBACK_CONTROL_PLANE_URL = previous
  })

  it('is a successful no-op without a hosted billing URL', async () => {
    delete process.env.QUACKBACK_CONTROL_PLANE_URL
    expect(isHostedBillingConfigured()).toBe(false)
    await expect(runUsageReport(job({ month: '2026-07' }))).resolves.toBeUndefined()
    expect(hoisted.reportWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('posts the snapshot for the payload month', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    await runUsageReport(job({ month: '2026-07' }))
    expect(hoisted.reportWorkspaceUsage).toHaveBeenCalledWith({
      month: '2026-07',
      aiTokens: 1_200_000,
      emailsSent: 42,
      teamSeatCount: 3,
      pendingInviteCount: 1,
      postCount: 8,
      boardCount: 2,
    })
  })

  it('uses the previous UTC month of now when payload.month is absent', () => {
    const now = new Date('2026-08-01T00:10:00.000Z')
    expect(monthFromJob(job({ scheduledFor: '2026-08-01T00:10:00+09:00' }), now)).toBe('2026-07')
    expect(monthFromJob(job({}), now)).toBe('2026-07')
    expect(monthFromJob(job({ month: '2026-04' }), now)).toBe('2026-04')
  })

  it('posts the previous UTC month of now when payload.month is absent', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    vi.useFakeTimers({ now: new Date('2026-08-01T00:10:00.000Z') })
    await runUsageReport(job({ scheduledFor: '2026-02-01T00:10:00.000Z' }, 'usage-report:2026-07'))
    expect(hoisted.reportWorkspaceUsage).toHaveBeenCalledWith(
      expect.objectContaining({ month: '2026-07' })
    )
    expect(hoisted.enqueueJob).not.toHaveBeenCalled()
  })

  it('enqueues the previous UTC month from an hourly slot without posting it', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    vi.useFakeTimers({ now: new Date('2026-08-01T00:10:00.000Z') })
    await runUsageReport(
      job({ scheduledFor: '2026-08-01T00:10:00.000Z' }, 'usage-report:2026-08-01T00:10:00.000Z')
    )
    expect(hoisted.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'usage-report',
        payload: { month: '2026-07' },
        dedupeKey: 'usage-report:2026-07',
      })
    )
    expect(hoisted.reportWorkspaceUsage).not.toHaveBeenCalled()
    expect(hoisted.cancelJob).not.toHaveBeenCalled()
  })

  it('detects plan limits from the hourly slot and from the monthly report', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    vi.useFakeTimers({ now: new Date('2026-08-01T00:10:00.000Z') })
    // The monthly report is the job the dormant catch-up queues for a parked
    // workspace, which runs no hourly slot.
    await runUsageReport(job({ month: '2026-07' }, 'usage-report:2026-07'))
    expect(hoisted.detectPlanLimitsQuietly).toHaveBeenCalledTimes(1)
    expect(hoisted.reportWorkspaceUsage).toHaveBeenCalledTimes(1)
    await runUsageReport(
      job({ scheduledFor: '2026-08-01T00:10:00.000Z' }, 'usage-report:2026-08-01T00:10:00.000Z')
    )
    expect(hoisted.detectPlanLimitsQuietly).toHaveBeenCalledTimes(2)
  })

  it('detects nothing without a hosted billing URL', async () => {
    delete process.env.QUACKBACK_CONTROL_PLANE_URL
    await runUsageReport(job({ month: '2026-07' }, 'usage-report:2026-07'))
    await runUsageReport(
      job({ scheduledFor: '2026-08-01T00:10:00.000Z' }, 'usage-report:2026-08-01T00:10:00.000Z')
    )
    expect(hoisted.detectPlanLimitsQuietly).not.toHaveBeenCalled()
  })

  it('sends the due plan limits email from the hourly slot, after detection', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    vi.useFakeTimers({ now: new Date('2026-08-01T00:10:00.000Z') })
    await runUsageReport(job({ month: '2026-07' }, 'usage-report:2026-07'))
    expect(hoisted.sendPlanLimitsEmailsQuietly).not.toHaveBeenCalled()
    await runUsageReport(
      job({ scheduledFor: '2026-08-01T00:10:00.000Z' }, 'usage-report:2026-08-01T00:10:00.000Z')
    )
    expect(hoisted.sendPlanLimitsEmailsQuietly).toHaveBeenCalledTimes(1)
    expect(hoisted.sendPlanLimitsEmailsQuietly).toHaveBeenCalledWith(hoisted.planLimitsView)
    expect(hoisted.detectPlanLimitsQuietly.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.getPlanLimits.mock.invocationCallOrder[0]!
    )
  })

  it('keeps the hourly slot going when reading plan limits for the emails fails', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    vi.useFakeTimers({ now: new Date('2026-08-01T00:10:00.000Z') })
    hoisted.getPlanLimits.mockRejectedValueOnce(new Error('db down'))
    await expect(
      runUsageReport(
        job({ scheduledFor: '2026-08-01T00:10:00.000Z' }, 'usage-report:2026-08-01T00:10:00.000Z')
      )
    ).resolves.toBeUndefined()
    expect(hoisted.sendPlanLimitsEmailsQuietly).not.toHaveBeenCalled()
    expect(hoisted.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'usage-report:2026-07' })
    )
  })

  it('sends no plan limits email without hosted billing', async () => {
    delete process.env.QUACKBACK_CONTROL_PLANE_URL
    await runUsageReport(
      job({ scheduledFor: '2026-08-01T00:10:00.000Z' }, 'usage-report:2026-08-01T00:10:00.000Z')
    )
    expect(hoisted.getPlanLimits).not.toHaveBeenCalled()
    expect(hoisted.sendPlanLimitsEmailsQuietly).not.toHaveBeenCalled()
  })

  it('skips the post when the month is already recorded', async () => {
    process.env.QUACKBACK_CONTROL_PLANE_URL = 'https://billing.example.com'
    vi.useFakeTimers({ now: new Date('2026-08-01T01:10:00.000Z') })
    hoisted.enqueueJob.mockResolvedValueOnce({ inserted: false, jobId: 'job_x' })
    await runUsageReport(
      job({ scheduledFor: '2026-08-01T01:10:00.000Z' }, 'usage-report:2026-08-01T01:10:00.000Z')
    )
    expect(hoisted.reportWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('is keyed per month so a second close of the same month coalesces', () => {
    expect(usageReportDedupeKey('2026-07')).toBe('usage-report:2026-07')
    expect(usageReportDedupeKey('2026-07')).toBe(usageReportDedupeKey('2026-07'))
    expect(usageReportDedupeKey('2026-08')).not.toBe(usageReportDedupeKey('2026-07'))
    expect(previousUtcMonth(new Date('2026-08-01T00:10:00.000Z'))).toBe('2026-07')
  })
})

describe('usage-report job retention', () => {
  it('keeps the monthly dedupe row past the previous-month reporting window', async () => {
    const { retentionOverrides } = await import('@/lib/server/jobs/definitions')
    const day = 86_400_000
    expect(retentionOverrides()['usage-report']?.succeeded).toBeGreaterThanOrEqual(40 * day)
  })
})
