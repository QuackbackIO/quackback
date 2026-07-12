/**
 * Maintenance start guard (status.maintenance.ts): handleMaintenanceStart
 * re-fetches current DB state and no-ops unless the STORED scheduledStartAt
 * has actually passed. This proves the reschedule case: a delayed BullMQ
 * job queued for the old 17:00 boundary must not flip the window live when
 * it fires, if the window has since been rescheduled to 21:00 — the guard
 * reads the fresh row, sees 21:00 > now, and no-ops rather than trusting
 * the job's original timing.
 *
 * Split into its own file (rather than folded into status.reconcile.test.ts)
 * because it mocks '../status.components' to isolate the guard from
 * reconcileComponentStatus, which the sibling file mocks `db` underneath
 * directly to unit-test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'

const mockIncidentFindFirst = vi.fn()
const mockIncidentComponentsFindMany = vi.fn()
const mockIncidentUpdateSet = vi.fn()
const mockUpdatesInsertValues = vi.fn()
const mockReconcileComponentStatus = vi.fn()
const mockDispatchStatusEvent = vi.fn().mockResolvedValue(undefined)

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
  scheduleDispatch: vi.fn(),
  cancelScheduledDispatch: vi.fn(),
}))

import { handleMaintenanceStart } from '../status.maintenance'

const COMPONENT_ID = 'status_component_test' as StatusComponentId
const INCIDENT_A = 'status_incident_a' as StatusIncidentId
const INCIDENT_B = 'status_incident_b' as StatusIncidentId

describe('handleMaintenanceStart — stale reschedule boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not start a window rescheduled from 17:00 to 21:00 when a stale 17:00 job fires', async () => {
    vi.setSystemTime(new Date('2026-07-12T17:00:00.000Z'))

    mockIncidentFindFirst.mockResolvedValue({
      id: INCIDENT_A,
      kind: 'maintenance',
      status: 'scheduled',
      deletedAt: null,
      title: 'Rescheduled maintenance',
      // Rescheduled forward to 21:00 — later than "now" (17:00). The stale
      // job carries only the incidentId, so the handler must read this
      // fresh value rather than trust its own firing time.
      scheduledStartAt: new Date('2026-07-12T21:00:00.000Z'),
      scheduledEndAt: new Date('2026-07-12T22:00:00.000Z'),
      autoStart: true,
      autoComplete: true,
    })

    await handleMaintenanceStart(INCIDENT_A)

    // The stale boundary check compares the fresh scheduledStartAt (21:00)
    // against Date.now() (17:00) and must no-op: no status flip, no
    // component reconciliation, no "started" update row, no event.
    expect(mockIncidentUpdateSet).not.toHaveBeenCalled()
    expect(mockReconcileComponentStatus).not.toHaveBeenCalled()
    expect(mockUpdatesInsertValues).not.toHaveBeenCalled()
    expect(mockDispatchStatusEvent).not.toHaveBeenCalled()
  })

  it('control: does start when the (unmodified) boundary has actually passed', async () => {
    vi.setSystemTime(new Date('2026-07-12T21:00:01.000Z'))

    mockIncidentFindFirst.mockResolvedValue({
      id: INCIDENT_B,
      kind: 'maintenance',
      status: 'scheduled',
      deletedAt: null,
      title: 'Due maintenance',
      scheduledStartAt: new Date('2026-07-12T21:00:00.000Z'),
      scheduledEndAt: new Date('2026-07-12T22:00:00.000Z'),
      autoStart: true,
      autoComplete: true,
    })
    mockIncidentComponentsFindMany.mockResolvedValue([{ componentId: COMPONENT_ID }])

    await handleMaintenanceStart(INCIDENT_B)

    expect(mockIncidentUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' })
    )
    expect(mockReconcileComponentStatus).toHaveBeenCalledWith(
      COMPONENT_ID,
      'maintenance',
      INCIDENT_B
    )
    expect(mockDispatchStatusEvent).toHaveBeenCalledWith(
      'status.maintenance_started',
      expect.anything(),
      expect.objectContaining({ incidentId: INCIDENT_B })
    )
  })

  it('also no-ops when the status is no longer "scheduled" (already started/canceled elsewhere)', async () => {
    vi.setSystemTime(new Date('2026-07-12T21:00:01.000Z'))

    mockIncidentFindFirst.mockResolvedValue({
      id: INCIDENT_A,
      kind: 'maintenance',
      status: 'in_progress', // a duplicate stale job firing after it already started
      deletedAt: null,
      title: 'Already started',
      scheduledStartAt: new Date('2026-07-12T21:00:00.000Z'),
      scheduledEndAt: new Date('2026-07-12T22:00:00.000Z'),
      autoStart: true,
      autoComplete: true,
    })

    await handleMaintenanceStart(INCIDENT_A)

    expect(mockIncidentUpdateSet).not.toHaveBeenCalled()
    expect(mockReconcileComponentStatus).not.toHaveBeenCalled()
  })
})
