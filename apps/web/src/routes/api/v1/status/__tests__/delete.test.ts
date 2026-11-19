/**
 * DELETE on status services (and the legacy components path) and incidents.
 *
 * Both call the same domain functions as the dashboard, under the same
 * permissions it requires, and answer 204, or 404 when the row is missing or
 * already deleted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'

const mockWithApiKeyAuth = vi.fn()
const mockDeleteStatusComponent = vi.fn()
const mockDeleteIncident = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/status', () => ({
  deleteStatusComponent: (...args: unknown[]) => mockDeleteStatusComponent(...args),
  deleteIncident: (...args: unknown[]) => mockDeleteIncident(...args),
}))

import { Route as ServiceRoute } from '../services/$serviceId'
import { Route as ComponentRoute } from '../components/$componentId'
import { Route as IncidentRoute } from '../incidents/$incidentId'

type DeleteHandler = (args: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>

function deleteHandler(route: unknown): DeleteHandler {
  return (route as { options: { server: { handlers: { DELETE: DeleteHandler } } } }).options.server
    .handlers.DELETE
}

const COMPONENT_ID = 'status_component_01h455vb4pex5vsknk084sn02q'
const INCIDENT_ID = 'status_incident_01h455vb4pex5vsknk084sn02q'

function makeRequest(path: string): Request {
  return new Request(`http://test/api/v1/status/${path}`, { method: 'DELETE' })
}

beforeEach(() => {
  mockWithApiKeyAuth.mockReset().mockResolvedValue({ principalId: 'principal_1' })
  mockDeleteStatusComponent.mockReset().mockResolvedValue(undefined)
  mockDeleteIncident.mockReset().mockResolvedValue(undefined)
})

describe.each([
  ['services', ServiceRoute, { serviceId: COMPONENT_ID }],
  ['components', ComponentRoute, { componentId: COMPONENT_ID }],
])('DELETE /api/v1/status/%s/:id', (path, route, params) => {
  const DELETE = deleteHandler(route)

  it('deletes the service with the manage permission and returns 204', async () => {
    const res = await DELETE({ request: makeRequest(`${path}/${COMPONENT_ID}`), params })

    expect(res.status).toBe(204)
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), {
      permission: PERMISSIONS.STATUS_PAGE_MANAGE,
    })
    expect(mockDeleteStatusComponent).toHaveBeenCalledWith(COMPONENT_ID)
  })

  it('returns 404 when the service is missing or already deleted', async () => {
    mockDeleteStatusComponent.mockRejectedValue(
      new NotFoundError('STATUS_COMPONENT_NOT_FOUND', 'Status component not found')
    )

    const res = await DELETE({ request: makeRequest(`${path}/${COMPONENT_ID}`), params })

    expect(res.status).toBe(404)
  })

  it('rejects an ID of another type without touching the domain', async () => {
    const res = await DELETE({
      request: makeRequest(`${path}/${INCIDENT_ID}`),
      params: Object.fromEntries(Object.keys(params).map((key) => [key, INCIDENT_ID])),
    })

    expect(res.status).toBe(400)
    expect(mockDeleteStatusComponent).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/status/incidents/:incidentId', () => {
  const DELETE = deleteHandler(IncidentRoute)
  const params = { incidentId: INCIDENT_ID }

  it('deletes the incident with the publish permission and returns 204', async () => {
    const res = await DELETE({ request: makeRequest(`incidents/${INCIDENT_ID}`), params })

    expect(res.status).toBe(204)
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), {
      permission: PERMISSIONS.STATUS_PAGE_PUBLISH,
    })
    expect(mockDeleteIncident).toHaveBeenCalledWith(INCIDENT_ID)
  })

  it('returns 404 when the incident is missing or already deleted', async () => {
    mockDeleteIncident.mockRejectedValue(
      new NotFoundError('STATUS_INCIDENT_NOT_FOUND', 'Status incident not found')
    )

    const res = await DELETE({ request: makeRequest(`incidents/${INCIDENT_ID}`), params })

    expect(res.status).toBe(404)
  })
})
