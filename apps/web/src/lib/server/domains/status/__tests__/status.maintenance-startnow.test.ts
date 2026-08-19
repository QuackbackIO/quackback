/**
 * startMaintenanceNow: the admin "Start now" action for a scheduled window.
 *
 * handleMaintenanceStart's guard requires scheduledStartAt <= now, so an
 * early start MUST rewrite the start bound first — calling the handler
 * directly is a silent no-op, and a bare postIncidentUpdate('in_progress')
 * would skip component-status application entirely. This suite pins the
 * wrapper's contract: guard, old-job cancellation, bound rewrite, handler
 * delegation, and re-enqueue of the auto-complete job under the new hash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'
import { ValidationError, NotFoundError } from '@/lib/shared/errors'

const mockIncidentFindFirst = vi.fn()
const mockIncidentComponentsFindMany = vi.fn()
const mockIncidentUpdateSet = vi.fn()
const mockUpdatesInsertValues = vi.fn()
const mockReconcileComponentStatus = vi.fn()
const mockDispatchStatusEvent = vi.fn().mockResolvedValue(undefined)
const mockScheduleDispatch = vi.fn()
const mockCancelScheduledDispatch = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      statusIncidents: { findFirst: (...args: unknown[]) => mockIncidentFindFirst(...args) },
      statusIncidentComponents: {
        findMany: (...args: unknown[]) => mockIncidentComponentsFindMany(...args),
      },
    },
    update: () => ({
      set: (arg: unknown) => {
        mockIncidentUpdateSet(arg)
        return { where: () => Promise.resolve() }
      },
    }),
    insert: () => ({
      values: (arg: unknown) => {
        mockUpdatesInsertValues(arg)
        return Promise.resolve()
      },
    }),
  },
}))

vi.mock('../status.components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../status.components')>()),
  reconcileComponentStatus: (...args: unknown[]) => mockReconcileComponentStatus(...args),
  dispatchStatusEvent: (...args: unknown[]) => mockDispatchStatusEvent(...args),
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: (...args: unknown[]) => mockScheduleDispatch(...args),
  cancelScheduledDispatch: (...args: unknown[]) => mockCancelScheduledDispatch(...args),
}))

import { startMaintenanceNow } from '../status.maintenance'

const INCIDENT_ID = 'si_startnow1' as StatusIncidentId
const COMPONENT_ID = 'sc_comp1' as StatusComponentId

const FUTURE_START = new Date(Date.now() + 60 * 60 * 1000)
const FUTURE_END = new Date(Date.now() + 3 * 60 * 60 * 1000)

function scheduledWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    kind: 'maintenance',
    status: 'scheduled',
    title: 'Failover test',
    scheduledStartAt: FUTURE_START,
    scheduledEndAt: FUTURE_END,
    autoStart: true,
    autoComplete: true,
    resolvedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIncidentComponentsFindMany.mockResolvedValue([
    { incidentId: INCIDENT_ID, componentId: COMPONENT_ID, componentStatus: 'under_maintenance' },
  ])
  mockReconcileComponentStatus.mockResolvedValue(undefined)
  mockScheduleDispatch.mockResolvedValue(undefined)
  mockCancelScheduledDispatch.mockResolvedValue(undefined)
})

describe('startMaintenanceNow', () => {
  it('rejects a non-maintenance incident', async () => {
    mockIncidentFindFirst.mockResolvedValue(scheduledWindow({ kind: 'incident' }))
    await expect(startMaintenanceNow(INCIDENT_ID)).rejects.toBeInstanceOf(ValidationError)
    expect(mockIncidentUpdateSet).not.toHaveBeenCalled()
  })

  it('rejects a window that is not scheduled (already started)', async () => {
    mockIncidentFindFirst.mockResolvedValue(scheduledWindow({ status: 'in_progress' }))
    await expect(startMaintenanceNow(INCIDENT_ID)).rejects.toBeInstanceOf(ValidationError)
    expect(mockIncidentUpdateSet).not.toHaveBeenCalled()
  })

  it('404s a missing/deleted window', async () => {
    mockIncidentFindFirst.mockResolvedValue(undefined)
    await expect(startMaintenanceNow(INCIDENT_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('cancels old jobs, pulls the start bound to now, starts, and re-enqueues completion', async () => {
    const window = scheduledWindow()
    // First fetch: the wrapper's guard. Second fetch: handleMaintenanceStart's
    // own re-read, which must observe the rewritten (now-past) start bound.
    mockIncidentFindFirst
      .mockResolvedValueOnce(window)
      .mockResolvedValueOnce({ ...window, scheduledStartAt: new Date(Date.now() - 1000) })

    await startMaintenanceNow(INCIDENT_ID)

    // Old schedule's jobs cancelled under the OLD hash (original start time).
    const oldHash = `${FUTURE_START.getTime()}-${FUTURE_END.getTime()}`
    expect(mockCancelScheduledDispatch).toHaveBeenCalledWith(
      `status-maintenance-start--${INCIDENT_ID}--${oldHash}`
    )
    expect(mockCancelScheduledDispatch).toHaveBeenCalledWith(
      `status-maintenance-complete--${INCIDENT_ID}--${oldHash}`
    )

    // Start bound rewritten before the handler ran.
    const boundRewrite = mockIncidentUpdateSet.mock.calls[0][0] as { scheduledStartAt: Date }
    expect(boundRewrite.scheduledStartAt.getTime()).toBeLessThanOrEqual(Date.now())

    // The handler actually started the window: in_progress + component
    // reconcile + the auto timeline entry.
    expect(mockIncidentUpdateSet.mock.calls[1][0]).toMatchObject({ status: 'in_progress' })
    expect(mockReconcileComponentStatus).toHaveBeenCalledWith(
      COMPONENT_ID,
      'maintenance',
      INCIDENT_ID
    )
    expect(mockUpdatesInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' })
    )

    // Auto-complete re-enqueued under the NEW hash (rewritten start).
    const completeCall = mockScheduleDispatch.mock.calls.find((c) =>
      (c[0] as { jobId: string }).jobId.startsWith(`status-maintenance-complete--${INCIDENT_ID}`)
    )
    expect(completeCall).toBeDefined()
    expect((completeCall![0] as { jobId: string }).jobId).not.toContain(
      String(FUTURE_START.getTime())
    )
    // No start job re-enqueued: the window is already in progress.
    const startCall = mockScheduleDispatch.mock.calls.find((c) =>
      (c[0] as { jobId: string }).jobId.startsWith(`status-maintenance-start--${INCIDENT_ID}`)
    )
    expect(startCall).toBeUndefined()
  })
})
