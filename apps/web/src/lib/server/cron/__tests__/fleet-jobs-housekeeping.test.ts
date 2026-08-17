/**
 * `housekeeping` folds the hourly set, a once-per-23h daily cycle, and
 * migrator convergence into one cron job. These tests pin the two contracts
 * that would otherwise be invisible: the daily stage must not re-run on the
 * next hourly tick, and a migrator-stage failure must fail the job (sweep
 * bodies already log-and-continue).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000

const {
  lockNow,
  lockStore,
  sweepExpiredKv,
  refreshStaleSummaries,
  sweepMergeSuggestions,
  reconcileChangelogNotifications,
  reconcileStatusNotifications,
  reconcileMaintenanceWindows,
  pruneAuditLog,
  sweepExpiredPortalInvites,
  pruneEventsOutbox,
  cleanupExpiredLogs,
  cleanupExpiredToolCalls,
  cleanupExpiredAssistantEvents,
  cleanupExpiredMessageTranslations,
  startTelemetry,
  enrolActiveWorkspaces,
  runReconcilePass,
} = vi.hoisted(() => {
  const lockNow = { ms: 1_700_000_000_000 }
  const lockStore = new Map<string, number>()
  return {
    lockNow,
    lockStore,
    sweepExpiredKv: vi.fn(),
    refreshStaleSummaries: vi.fn(),
    sweepMergeSuggestions: vi.fn(),
    reconcileChangelogNotifications: vi.fn(),
    reconcileStatusNotifications: vi.fn(),
    reconcileMaintenanceWindows: vi.fn(),
    pruneAuditLog: vi.fn(),
    sweepExpiredPortalInvites: vi.fn(),
    pruneEventsOutbox: vi.fn(),
    cleanupExpiredLogs: vi.fn(),
    cleanupExpiredToolCalls: vi.fn(),
    cleanupExpiredAssistantEvents: vi.fn(),
    cleanupExpiredMessageTranslations: vi.fn(),
    startTelemetry: vi.fn(),
    enrolActiveWorkspaces: vi.fn(),
    runReconcilePass: vi.fn(),
  }
})

vi.mock('@/lib/server/sweep-lock', () => ({
  withSweepLock: async (
    name: string,
    ttlMs: number,
    fn: () => Promise<void>,
    opts?: { keepUntilExpiry?: boolean }
  ) => {
    const expiresAt = lockStore.get(name)
    if (expiresAt !== undefined && expiresAt > lockNow.ms) return
    lockStore.set(name, lockNow.ms + ttlMs)
    try {
      await fn()
    } finally {
      if (!opts?.keepUntilExpiry) lockStore.delete(name)
    }
  },
}))

vi.mock('@/lib/server/kv/sweep', () => ({ sweepExpiredKv }))
vi.mock('@/lib/server/domains/summary/summary.service', () => ({ refreshStaleSummaries }))
vi.mock('@/lib/server/domains/merge-suggestions/merge-check.service', () => ({
  sweepMergeSuggestions,
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  reconcileChangelogNotifications,
}))
vi.mock('@/lib/server/domains/status/status.service', () => ({ reconcileStatusNotifications }))
vi.mock('@/lib/server/domains/status/status.maintenance', () => ({
  reconcileMaintenanceWindows,
}))
vi.mock('@/lib/server/audit/log', () => ({ pruneAuditLog }))
vi.mock('@/lib/server/audit/invite-sweep', () => ({ sweepExpiredPortalInvites }))
vi.mock('@/lib/server/events/events-sweep', () => ({ pruneEventsOutbox }))
vi.mock('@/lib/server/domains/ai/usage-log', () => ({ cleanupExpiredLogs }))
vi.mock('@/lib/server/domains/assistant/tool-audit', () => ({
  cleanupExpiredToolCalls,
  cleanupExpiredAssistantEvents,
}))
vi.mock('@/lib/server/domains/conversation/conversation-translation.service', () => ({
  cleanupExpiredMessageTranslations,
}))
vi.mock('@/lib/server/telemetry', () => ({ startTelemetry }))
vi.mock('@/lib/server/fleet/migrator', () => ({
  enrolActiveWorkspaces,
  runReconcilePass,
}))

import { FLEET_CRON_JOBS, runFleetCronJob } from '@/lib/server/cron/fleet-jobs'

function emptyPass(overrides: { failed?: number } = {}) {
  return {
    claimed: 0,
    reconciled: 0,
    healed: 0,
    alreadyCurrent: 0,
    failed: overrides.failed ?? 0,
    refusedRecords: 0,
    reaped: { requeued: 0, terminated: 0 },
    outcomes: [],
  }
}

function reject(label: string) {
  return vi.fn(async () => {
    throw new Error(`${label} failed`)
  })
}

beforeEach(() => {
  lockNow.ms = 1_700_000_000_000
  lockStore.clear()
  for (const fn of [
    sweepExpiredKv,
    refreshStaleSummaries,
    sweepMergeSuggestions,
    reconcileChangelogNotifications,
    reconcileStatusNotifications,
    reconcileMaintenanceWindows,
    pruneAuditLog,
    sweepExpiredPortalInvites,
    pruneEventsOutbox,
    cleanupExpiredLogs,
    cleanupExpiredToolCalls,
    cleanupExpiredAssistantEvents,
    cleanupExpiredMessageTranslations,
    startTelemetry,
    enrolActiveWorkspaces,
    runReconcilePass,
  ]) {
    fn.mockReset()
    fn.mockResolvedValue(fn === runReconcilePass ? emptyPass() : undefined)
  }
  enrolActiveWorkspaces.mockResolvedValue(0)
})

describe('housekeeping', () => {
  it('is a named cron job alongside hourly and daily', () => {
    expect(FLEET_CRON_JOBS.housekeeping).toEqual(expect.any(Function))
    expect(FLEET_CRON_JOBS.hourly).toEqual(expect.any(Function))
    expect(FLEET_CRON_JOBS.daily).toEqual(expect.any(Function))
  })

  it('runs the daily set at most once per 23 h window across repeated invocations', async () => {
    expect(await runFleetCronJob('housekeeping')).toBe(true)
    expect(await runFleetCronJob('housekeeping')).toBe(true)

    expect(startTelemetry).toHaveBeenCalledTimes(1)
    expect(startTelemetry).toHaveBeenCalledWith({ once: true })
    expect(pruneAuditLog).toHaveBeenCalledTimes(1)
    expect(sweepExpiredPortalInvites).toHaveBeenCalledTimes(1)
    expect(pruneEventsOutbox).toHaveBeenCalledTimes(1)
    expect(cleanupExpiredLogs).toHaveBeenCalledTimes(1)

    // Hourly bodies are not gated by the 23 h claim: they run every tick.
    expect(sweepExpiredKv).toHaveBeenCalledTimes(2)
    expect(refreshStaleSummaries).toHaveBeenCalledTimes(2)
    expect(sweepMergeSuggestions).toHaveBeenCalledTimes(2)
    expect(reconcileChangelogNotifications).toHaveBeenCalledTimes(2)
    expect(reconcileStatusNotifications).toHaveBeenCalledTimes(2)
    expect(reconcileMaintenanceWindows).toHaveBeenCalledTimes(2)

    lockNow.ms += TWENTY_THREE_HOURS - 1
    expect(await runFleetCronJob('housekeeping')).toBe(true)
    expect(startTelemetry).toHaveBeenCalledTimes(1)
    expect(pruneAuditLog).toHaveBeenCalledTimes(1)

    lockNow.ms += 1
    expect(await runFleetCronJob('housekeeping')).toBe(true)
    expect(startTelemetry).toHaveBeenCalledTimes(2)
    expect(pruneAuditLog).toHaveBeenCalledTimes(2)
  })

  it('fails the job when enrol throws, without running reconcile', async () => {
    enrolActiveWorkspaces.mockRejectedValue(new Error('enrol failed'))

    expect(await runFleetCronJob('housekeeping')).toBe(false)
    expect(enrolActiveWorkspaces).toHaveBeenCalledOnce()
    expect(runReconcilePass).not.toHaveBeenCalled()
  })

  it('fails the job when any workspace fails to reconcile', async () => {
    runReconcilePass.mockResolvedValue(emptyPass({ failed: 1 }))

    expect(await runFleetCronJob('housekeeping')).toBe(false)
    expect(enrolActiveWorkspaces).toHaveBeenCalledOnce()
    expect(runReconcilePass).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 4, leaseMs: 900_000 })
    )
  })

  it('log-and-continues sweep-body failures and still succeeds when the migrator does', async () => {
    sweepExpiredKv.mockImplementation(reject('kv'))
    refreshStaleSummaries.mockImplementation(reject('summary'))
    sweepMergeSuggestions.mockImplementation(reject('merge'))
    reconcileChangelogNotifications.mockImplementation(reject('changelog'))
    reconcileStatusNotifications.mockImplementation(reject('status'))
    reconcileMaintenanceWindows.mockImplementation(reject('maintenance'))
    pruneAuditLog.mockImplementation(reject('audit'))
    sweepExpiredPortalInvites.mockImplementation(reject('invite'))
    pruneEventsOutbox.mockImplementation(reject('outbox'))
    cleanupExpiredLogs.mockImplementation(reject('logs'))
    cleanupExpiredToolCalls.mockImplementation(reject('tool-calls'))
    cleanupExpiredAssistantEvents.mockImplementation(reject('assistant'))
    cleanupExpiredMessageTranslations.mockImplementation(reject('translations'))

    expect(await runFleetCronJob('housekeeping')).toBe(true)
    expect(enrolActiveWorkspaces).toHaveBeenCalledOnce()
    expect(runReconcilePass).toHaveBeenCalledOnce()
  })
})
