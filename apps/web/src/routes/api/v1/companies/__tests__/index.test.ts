import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyId, PrincipalId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockListCompaniesPage = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/companies/company.service', () => ({
  listCompaniesPage: (...args: unknown[]) => mockListCompaniesPage(...args),
}))

import { Route } from '../index'

type RouteOpts = { server: { handlers: { GET: (...args: unknown[]) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId
const COMPANY_ID = 'company_01kqhxq697fvgat0h1abc12345' as unknown as CompanyId
const CURSOR_ID = 'company_01kqhxq697fvgat0h2def67890' as unknown as CompanyId

const adminAuth = { principalId: KEY_PRINCIPAL, role: 'admin', importMode: false }

const companyRow = {
  id: COMPANY_ID,
  name: 'Acme Corp',
  domain: 'acme.example',
  externalId: 'ext-1',
  plan: 'pro',
  mrrCents: 9900,
  size: '11-50',
  website: 'https://acme.example',
  industry: 'saas',
  source: 'api',
  customAttributes: { tier: 'gold' },
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-03T03:04:05.000Z'),
  memberCount: 7,
}

function makeRequest(query = ''): Request {
  return new Request(`http://test/api/v1/companies${query}`, { method: 'GET' })
}

describe('GET /api/v1/companies', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockListCompaniesPage.mockReset()
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockListCompaniesPage.mockResolvedValue({
      items: [companyRow],
      nextCursor: CURSOR_ID,
      hasMore: true,
    })
  })

  it('returns serialized companies with member counts and pagination meta', async () => {
    const res = await GET({ request: makeRequest() })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].id).toBe(COMPANY_ID)
    expect(json.data[0].name).toBe('Acme Corp')
    expect(json.data[0].memberCount).toBe(7)
    expect(json.data[0].customAttributes).toEqual({ tier: 'gold' })
    expect(json.data[0].createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(json.meta.pagination).toEqual({ cursor: CURSOR_ID, hasMore: true })
  })

  it('passes search, clamped limit, and a valid cursor to the domain query', async () => {
    await GET({ request: makeRequest(`?search=acme&limit=500&cursor=${CURSOR_ID}`) })
    expect(mockListCompaniesPage).toHaveBeenCalledWith({
      search: 'acme',
      limit: 100,
      cursor: CURSOR_ID,
    })
  })

  it('defaults limit and ignores a malformed cursor', async () => {
    await GET({ request: makeRequest('?cursor=not-a-typeid') })
    expect(mockListCompaniesPage).toHaveBeenCalledWith({
      search: undefined,
      limit: 20,
      cursor: undefined,
    })
  })

  it('propagates auth failures', async () => {
    const { UnauthorizedError } = await import('@/lib/shared/errors')
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('UNAUTHORIZED', 'Invalid API key'))
    const res = await GET({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(mockListCompaniesPage).not.toHaveBeenCalled()
  })

  it('maps company_id to an exact external-reference lookup', async () => {
    await GET({ request: makeRequest('?company_id=crm-42') })
    expect(mockListCompaniesPage).toHaveBeenCalledWith({
      search: undefined,
      limit: 20,
      cursor: undefined,
      externalId: 'crm-42',
      tagId: undefined,
      segmentId: undefined,
    })
  })

  it('passes valid tag_id and segment_id filters to the domain query', async () => {
    await GET({
      request: makeRequest(
        '?tag_id=user_tag_01kqhxq697fvgat0h2def67890&segment_id=segment_01kqhxq697fvgat0h3xyz67890'
      ),
    })
    expect(mockListCompaniesPage).toHaveBeenCalledWith({
      search: undefined,
      limit: 20,
      cursor: undefined,
      externalId: undefined,
      tagId: 'post_tag_01kqhxq697fvgat0h2def67890',
      segmentId: 'segment_01kqhxq697fvgat0h3xyz67890',
    })
  })

  it('degrades a malformed tag_id to an empty list, not an error', async () => {
    const res = await GET({ request: makeRequest('?tag_id=not-a-typeid') })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual([])
    expect(json.meta.pagination).toEqual({ cursor: null, hasMore: false })
    expect(mockListCompaniesPage).not.toHaveBeenCalled()
  })

  it('degrades a malformed segment_id to an empty list, not an error', async () => {
    const res = await GET({ request: makeRequest('?segment_id=not-a-typeid') })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual([])
    expect(mockListCompaniesPage).not.toHaveBeenCalled()
  })
})
