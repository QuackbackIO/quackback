/**
 * Incidents and maintenance share one status column but not one vocabulary.
 * A maintenance status on an incident (or the reverse) matches no lifecycle
 * check, so the row would be stranded: never "resolved", never in the active
 * set. The domain rejects the mismatch as bad input before writing anything,
 * and the REST layer turns that into a 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StatusComponentId, StatusIncidentId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { handleDomainError } from '@/lib/server/domains/api/responses'

const mockIncidentFindFirst = vi.fn()
const mockTransaction = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      statusIncidents: { findFirst: (...args: unknown[]) => mockIncidentFindFirst(...args) },
    },
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

import { createIncident, postIncidentUpdate } from '../status.service'

const COMPONENT_ID = 'status_component_a' as StatusComponentId
const INCIDENT_ID = 'status_incident_a' as StatusIncidentId

function input(kind: 'incident' | 'maintenance', status: string) {
  return {
    kind,
    title: 'Mismatch',
    status: status as 'resolved',
    body: 'Body',
    affectedComponents: [{ componentId: COMPONENT_ID, componentStatus: 'major_outage' as const }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createIncident: kind and status must agree', () => {
  it.each([
    ['incident', 'completed'],
    ['incident', 'scheduled'],
    ['maintenance', 'resolved'],
    ['maintenance', 'investigating'],
  ] as const)('rejects a %s with status %s and writes nothing', async (kind, status) => {
    const err = await createIncident(input(kind, status), {
      principalId: 'principal_a' as never,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).message).toContain(`"${status}"`)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(handleDomainError(err).status).toBe(400)
  })
})

describe('postIncidentUpdate: the new status must belong to the row kind', () => {
  it('rejects a maintenance status on an incident', async () => {
    mockIncidentFindFirst.mockResolvedValue({
      id: INCIDENT_ID,
      kind: 'incident',
      status: 'investigating',
      deletedAt: null,
    })

    const err = await postIncidentUpdate(
      INCIDENT_ID,
      { status: 'completed', body: 'Done' },
      { principalId: null }
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects an incident status on a maintenance window', async () => {
    mockIncidentFindFirst.mockResolvedValue({
      id: INCIDENT_ID,
      kind: 'maintenance',
      status: 'in_progress',
      deletedAt: null,
    })

    const err = await postIncidentUpdate(
      INCIDENT_ID,
      { status: 'resolved', body: 'Done' },
      { principalId: null }
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
