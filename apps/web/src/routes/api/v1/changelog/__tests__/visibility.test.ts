import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  getOrgChangelogVisibilityMock: vi.fn(),
  setOrgChangelogVisibilityMock: vi.fn(),
  getAllSegmentChangelogVisibilitiesMock: vi.fn(),
  getSegmentChangelogVisibilityMock: vi.fn(),
  setSegmentChangelogVisibilityMock: vi.fn(),
  deleteSegmentChangelogVisibilityMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/changelog/changelog-visibility.service', () => ({
  getOrgChangelogVisibility: (...args: unknown[]) => hoisted.getOrgChangelogVisibilityMock(...args),
  setOrgChangelogVisibility: (...args: unknown[]) => hoisted.setOrgChangelogVisibilityMock(...args),
  getAllSegmentChangelogVisibilities: (...args: unknown[]) =>
    hoisted.getAllSegmentChangelogVisibilitiesMock(...args),
  getSegmentChangelogVisibility: (...args: unknown[]) =>
    hoisted.getSegmentChangelogVisibilityMock(...args),
  setSegmentChangelogVisibility: (...args: unknown[]) =>
    hoisted.setSegmentChangelogVisibilityMock(...args),
  deleteSegmentChangelogVisibility: (...args: unknown[]) =>
    hoisted.deleteSegmentChangelogVisibilityMock(...args),
}))

import { Route as OrgVisibilityRoute } from '../visibility'
import { Route as SegmentVisibilityRoute } from '../visibility.segments.$segmentId'
import { Route as SegmentsVisibilityRoute } from '../visibility.segments'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const orgHandlers = (OrgVisibilityRoute as unknown as RouteWithHandlers).options.server.handlers
const segmentHandlers = (SegmentVisibilityRoute as unknown as RouteWithHandlers).options.server
  .handlers
const segmentsHandlers = (SegmentsVisibilityRoute as unknown as RouteWithHandlers).options.server
  .handlers

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  params: Record<string, string> = {},
  request = new Request('http://test/api/v1/changelog/visibility')
) {
  return { request, params }
}

async function responseData(response: Response) {
  return ((await response.json()) as { data: unknown }).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: 'principal_admin', role: 'admin' })
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.getOrgChangelogVisibilityMock.mockResolvedValue({})
  hoisted.setOrgChangelogVisibilityMock.mockResolvedValue(undefined)
  hoisted.getAllSegmentChangelogVisibilitiesMock.mockResolvedValue([])
  hoisted.getSegmentChangelogVisibilityMock.mockResolvedValue(null)
  hoisted.setSegmentChangelogVisibilityMock.mockResolvedValue(undefined)
  hoisted.deleteSegmentChangelogVisibilityMock.mockResolvedValue(undefined)
})

describe('/api/v1/changelog/visibility', () => {
  it('reads org-level visibility with team API-key access', async () => {
    const config = {
      restrictCategories: true,
      allowedCategoryIds: ['cat_release'],
      restrictProducts: true,
      allowedProductIds: ['prod_web'],
    }
    hoisted.getOrgChangelogVisibilityMock.mockResolvedValue(config)

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual(config)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
  })

  it('updates org-level visibility with admin API-key access and returns the stored config', async () => {
    const requestConfig = {
      restrictCategories: true,
      allowedCategoryIds: ['cat_release'],
      restrictProducts: false,
      allowedProductIds: [],
    }
    const storedConfig = {
      ...requestConfig,
      allowedCategoryIds: ['cat_release', 'cat_ops'],
    }
    hoisted.getOrgChangelogVisibilityMock.mockResolvedValue(storedConfig)

    const response = await orgHandlers.PUT(
      args({}, jsonRequest('http://test/api/v1/changelog/visibility', 'PUT', requestConfig))
    )

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.setOrgChangelogVisibilityMock).toHaveBeenCalledWith(requestConfig)
    expect(await responseData(response)).toEqual(storedConfig)
  })

  it('rejects malformed org visibility bodies before mutating', async () => {
    const response = await orgHandlers.PUT(
      args(
        {},
        jsonRequest('http://test/api/v1/changelog/visibility', 'PUT', {
          restrictCategories: 'yes',
          allowedCategoryIds: [123],
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.setOrgChangelogVisibilityMock).not.toHaveBeenCalled()
  })
})

describe('/api/v1/changelog/visibility/segments', () => {
  it('lists every segment override with team API-key access', async () => {
    const rows = [
      {
        segmentId: 'segment_enterprise',
        segmentName: 'Enterprise',
        config: {
          restrictCategories: true,
          allowedCategoryIds: ['cat_enterprise'],
          restrictProducts: false,
          allowedProductIds: [],
        },
      },
    ]
    hoisted.getAllSegmentChangelogVisibilitiesMock.mockResolvedValue(rows)

    const response = await segmentsHandlers.GET(
      args({}, new Request('http://test/api/v1/changelog/visibility/segments'))
    )

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual(rows)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
  })

  it('reads, upserts, and deletes a segment override with parsed segment IDs', async () => {
    hoisted.parseTypeIdMock.mockReturnValue('segment_enterprise')
    const config = {
      restrictCategories: true,
      allowedCategoryIds: ['cat_enterprise'],
      restrictProducts: true,
      allowedProductIds: ['prod_enterprise'],
    }
    hoisted.getSegmentChangelogVisibilityMock.mockResolvedValue(config)

    const getResponse = await segmentHandlers.GET(
      args(
        { segmentId: 'segment_enterprise' },
        new Request('http://test/segments/segment_enterprise')
      )
    )
    expect(getResponse.status).toBe(200)
    expect(await responseData(getResponse)).toEqual({
      segmentId: 'segment_enterprise',
      config,
    })

    const putResponse = await segmentHandlers.PUT(
      args(
        { segmentId: 'segment_enterprise' },
        jsonRequest('http://test/segments/segment_enterprise', 'PUT', config)
      )
    )
    expect(putResponse.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenLastCalledWith(expect.any(Request), {
      role: 'admin',
    })
    expect(hoisted.setSegmentChangelogVisibilityMock).toHaveBeenCalledWith(
      'segment_enterprise',
      config
    )

    const deleteResponse = await segmentHandlers.DELETE(
      args(
        { segmentId: 'segment_enterprise' },
        new Request('http://test/segments/segment_enterprise')
      )
    )
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.deleteSegmentChangelogVisibilityMock).toHaveBeenCalledWith('segment_enterprise')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      'segment_enterprise',
      'segment',
      'segment ID'
    )
  })

  it('returns 404 for missing segment overrides and 400 for invalid update bodies', async () => {
    const missingResponse = await segmentHandlers.GET(
      args({ segmentId: 'segment_missing' }, new Request('http://test/segments/segment_missing'))
    )
    expect(missingResponse.status).toBe(404)

    const invalidResponse = await segmentHandlers.PUT(
      args(
        { segmentId: 'segment_enterprise' },
        jsonRequest('http://test/segments/segment_enterprise', 'PUT', {
          allowedProductIds: [false],
        })
      )
    )
    expect(invalidResponse.status).toBe(400)
    expect(hoisted.setSegmentChangelogVisibilityMock).not.toHaveBeenCalled()
  })
})
