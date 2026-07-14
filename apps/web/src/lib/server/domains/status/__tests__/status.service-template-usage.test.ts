/**
 * Template-usage provenance: postIncidentUpdate must record the template a
 * posted update was inserted from onto the update row's template_id, so usage
 * counts (count(*) group by template_id) reflect real provenance. Applying a
 * template then rewriting the body still counts as a use — the id rides along
 * regardless of later edits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StatusComponentId, StatusIncidentId, StatusIncidentTemplateId } from '@quackback/ids'

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

const INCIDENT_ID = 'si_tmplusage1' as StatusIncidentId
const COMPONENT_ID = 'sc_comp1' as StatusComponentId
const TEMPLATE_ID = 'status_tmpl_usage1' as StatusIncidentTemplateId

function incidentRow(status: string) {
  return {
    id: INCIDENT_ID,
    kind: 'incident',
    status,
    title: 'Elevated error rates',
    impact: 'major',
    impactOverride: false,
    scheduledStartAt: null,
    scheduledEndAt: null,
    autoStart: true,
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
    { incidentId: INCIDENT_ID, componentId: COMPONENT_ID, componentStatus: 'degraded_performance' },
  ])
  mockReconcileComponentStatus.mockResolvedValue(undefined)
})

describe('postIncidentUpdate: template provenance', () => {
  it('records templateId on the inserted update row', async () => {
    mockIncidentFindFirst.mockResolvedValue(incidentRow('investigating'))

    await postIncidentUpdate(
      INCIDENT_ID,
      {
        status: 'identified',
        body: 'Rewritten body, not the template text.',
        templateId: TEMPLATE_ID,
      },
      { principalId: null }
    )

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'identified',
        body: 'Rewritten body, not the template text.',
        templateId: TEMPLATE_ID,
      })
    )
  })

  it('inserts a null templateId when no template was used', async () => {
    mockIncidentFindFirst.mockResolvedValue(incidentRow('investigating'))

    await postIncidentUpdate(
      INCIDENT_ID,
      { status: 'monitoring', body: 'Freehand update.' },
      { principalId: null }
    )

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Freehand update.', templateId: null })
    )
  })
})
