/**
 * postIncidentUpdate lifecycle side-effects for maintenance windows.
 *
 * Posting 'in_progress' on a still-'scheduled' window from the editor's
 * stepper is a real start: it must apply component statuses and pull the
 * start bound to now (job guards + uptime derivation read it), exactly like
 * the scheduler's handleMaintenanceStart, but with the admin's own words as
 * the single timeline row. Without this branch the window "starts" on the
 * timeline while every affected service still shows operational.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'

const mockIncidentFindFirst = vi.fn()
const mockIncidentComponentsFindMany = vi.fn()
const mockUpdatesFindMany = vi.fn()
const mockUpdateSet = vi.fn()
const mockInsertValues = vi.fn()
const mockReconcileComponentStatus = vi.fn()
const mockDispatchStatusEvent = vi.fn().mockResolvedValue(undefined)
const mockEnqueueMaintenanceJobs = vi.fn()
const mockCancelMaintenanceJobs = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      statusIncidents: { findFirst: (...args: unknown[]) => mockIncidentFindFirst(...args) },
      statusIncidentComponents: {
        findMany: (...args: unknown[]) => mockIncidentComponentsFindMany(...args),
      },
      statusIncidentUpdates: { findMany: (...args: unknown[]) => mockUpdatesFindMany(...args) },
    },
    update: () => ({
      set: (arg: unknown) => {
        mockUpdateSet(arg)
        return { where: () => Promise.resolve() }
      },
    }),
    insert: () => ({
      values: (arg: unknown) => {
        mockInsertValues(arg)
        return Promise.resolve()
      },
    }),
    select: () => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.innerJoin = () => chain
      chain.where = () => Promise.resolve([])
      return chain
    },
  },
}))

vi.mock('../status.components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../status.components')>()),
  reconcileComponentStatus: (...args: unknown[]) => mockReconcileComponentStatus(...args),
  dispatchStatusEvent: (...args: unknown[]) => mockDispatchStatusEvent(...args),
}))

vi.mock('../status.maintenance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../status.maintenance')>()),
  enqueueMaintenanceJobs: (...args: unknown[]) => mockEnqueueMaintenanceJobs(...args),
  cancelMaintenanceJobs: (...args: unknown[]) => mockCancelMaintenanceJobs(...args),
}))

import { postIncidentUpdate } from '../status.service'

const INCIDENT_ID = 'si_postupd1' as StatusIncidentId
const COMPONENT_ID = 'sc_comp1' as StatusComponentId

function maintenanceRow(status: string) {
  return {
    id: INCIDENT_ID,
    kind: 'maintenance',
    status,
    title: 'Failover test',
    impact: 'maintenance',
    impactOverride: false,
    scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    autoStart: false,
    autoComplete: true,
    startedAt: new Date(),
    resolvedAt: null,
    backfilled: false,
    notifiedAt: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdatesFindMany.mockResolvedValue([])
  mockIncidentComponentsFindMany.mockResolvedValue([
    { incidentId: INCIDENT_ID, componentId: COMPONENT_ID, componentStatus: 'under_maintenance' },
  ])
  mockReconcileComponentStatus.mockResolvedValue(undefined)
  mockEnqueueMaintenanceJobs.mockResolvedValue(undefined)
  mockCancelMaintenanceJobs.mockResolvedValue(undefined)
})

describe('postIncidentUpdate: scheduled maintenance started via the stepper', () => {
  it('applies component statuses, pulls the start bound to now, and reschedules', async () => {
    mockIncidentFindFirst.mockResolvedValue(maintenanceRow('scheduled'))

    await postIncidentUpdate(
      INCIDENT_ID,
      { status: 'in_progress', body: 'Starting the failover now.' },
      { principalId: null }
    )

    // The admin's words are the timeline row.
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', body: 'Starting the failover now.' })
    )
    // Old schedule's jobs cancelled; start bound rewritten to now.
    expect(mockCancelMaintenanceJobs).toHaveBeenCalled()
    const set = mockUpdateSet.mock.calls[0][0] as { scheduledStartAt?: Date; status: string }
    expect(set.status).toBe('in_progress')
    expect(set.scheduledStartAt).toBeInstanceOf(Date)
    expect(set.scheduledStartAt!.getTime()).toBeLessThanOrEqual(Date.now())
    // Component statuses actually applied.
    expect(mockReconcileComponentStatus).toHaveBeenCalledWith(
      COMPONENT_ID,
      'maintenance',
      INCIDENT_ID
    )
    // Auto-complete job re-enqueued for the rewritten schedule.
    expect(mockEnqueueMaintenanceJobs).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' })
    )
  })

  it('does not re-apply or reschedule for a window that is already running', async () => {
    mockIncidentFindFirst.mockResolvedValue(maintenanceRow('in_progress'))

    await postIncidentUpdate(
      INCIDENT_ID,
      { status: 'verifying', body: 'Verifying replica health.' },
      { principalId: null }
    )

    expect(mockCancelMaintenanceJobs).not.toHaveBeenCalled()
    expect(mockEnqueueMaintenanceJobs).not.toHaveBeenCalled()
    expect(mockReconcileComponentStatus).not.toHaveBeenCalled()
    const set = mockUpdateSet.mock.calls[0][0] as { scheduledStartAt?: Date }
    expect(set.scheduledStartAt).toBeUndefined()
  })
})
