import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusComponentId, StatusIncidentId, StatusUpdateId } from '@quackback/ids'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

const mockFindMany = vi.fn()
const mockVisibleStatusComponentIds = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      statusIncidentUpdates: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
  eq: vi.fn((col, val) => ({ op: 'eq', col, val })),
  and: vi.fn((...args) => ({ op: 'and', args })),
  asc: vi.fn((col) => ({ op: 'asc', col })),
  exists: vi.fn((q) => ({ op: 'exists', q })),
  inArray: vi.fn((col, vals) => ({ op: 'inArray', col, vals })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    {}
  ),
  statusComponents: {
    id: 'status_components.id',
    position: 'status_components.position',
    segmentIds: 'status_components.segment_ids',
  },
  statusIncidents: { id: 'status_incidents.id' },
  statusIncidentUpdates: {
    incidentId: 'status_incident_updates.incident_id',
    createdAt: 'status_incident_updates.created_at',
  },
  statusIncidentComponents: {
    incidentId: 'status_incident_components.incident_id',
    componentId: 'status_incident_components.component_id',
  },
}))

vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  visibleStatusComponentIds: (...args: unknown[]) => mockVisibleStatusComponentIds(...args),
}))

import { projectIncidents } from '../status.projection'

beforeEach(() => {
  vi.clearAllMocks()
  mockVisibleStatusComponentIds.mockResolvedValue(null)
})

describe('projectIncidents batched update loading', () => {
  it('fetches updates for all incidents in a single batch query instead of N+1', async () => {
    const t1 = new Date('2026-11-20T00:00:00Z')
    const inc1 = 'status_incident_01' as StatusIncidentId
    const inc2 = 'status_incident_02' as StatusIncidentId
    const inc3 = 'status_incident_03' as StatusIncidentId
    const comp1 = 'status_component_01' as StatusComponentId

    const updates = [
      {
        id: 'status_update_1' as StatusUpdateId,
        incidentId: inc1,
        status: 'investigating',
        body: 'u1',
        createdAt: t1,
      },
      {
        id: 'status_update_2' as StatusUpdateId,
        incidentId: inc3,
        status: 'resolved',
        body: 'u3',
        createdAt: t1,
      },
    ]
    mockFindMany.mockResolvedValue(updates)

    const rows = [inc1, inc2, inc3].map((id, i) => ({
      id,
      kind: 'incident' as const,
      title: `Incident ${i + 1}`,
      status: 'investigating' as const,
      impact: 'minor' as const,
      scheduledStartAt: null,
      scheduledEndAt: null,
      startedAt: t1,
      resolvedAt: null,
      createdAt: t1,
      updatedAt: t1,
      deletedAt: null,
    }))

    const linksByIncident = new Map(
      [inc1, inc2, inc3].map((incidentId) => [
        incidentId,
        [
          {
            incidentId,
            componentId: comp1,
            componentStatus: 'degraded_performance' as const,
            name: 'API',
            segmentIds: [],
          },
        ],
      ])
    )

    const projected = await projectIncidents(rows as never, linksByIncident, ANONYMOUS_ACTOR)

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(projected).toHaveLength(3)
    expect(projected[0].updates.map((u) => u.id)).toEqual(['status_update_1'])
    expect(projected[1].updates).toEqual([])
    expect(projected[2].updates.map((u) => u.id)).toEqual(['status_update_2'])
  })

  it('short-circuits with zero queries when incident rows are empty', async () => {
    const projected = await projectIncidents([], new Map(), ANONYMOUS_ACTOR)
    expect(projected).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
    expect(mockVisibleStatusComponentIds).not.toHaveBeenCalled()
  })
})
