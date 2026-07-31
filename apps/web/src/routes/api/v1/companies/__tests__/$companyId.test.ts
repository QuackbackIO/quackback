import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyId, PrincipalId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockGetCompanyWithMemberCount = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/companies/company.service', () => ({
  getCompanyWithMemberCount: (...args: unknown[]) => mockGetCompanyWithMemberCount(...args),
}))

import { Route } from '../$companyId'

type RouteOpts = { server: { handlers: { GET: (...args: unknown[]) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId
const COMPANY_ID = 'company_01kqhxq697fvgat0h1abc12345' as unknown as CompanyId

const adminAuth = { principalId: KEY_PRINCIPAL, role: 'admin', importMode: false }

const companyRow = {
  id: COMPANY_ID,
  name: 'Acme Corp',
  domain: 'acme.example',
  externalId: null,
  plan: 'pro',
  mrrCents: 9900,
  size: null,
  website: null,
  industry: null,
  source: 'api',
  customAttributes: {},
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-03T03:04:05.000Z'),
  memberCount: 3,
}

function makeRequest(): Request {
  return new Request(`http://test/api/v1/companies/${COMPANY_ID}`, { method: 'GET' })
}

describe('GET /api/v1/companies/:companyId', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockGetCompanyWithMemberCount.mockReset()
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockGetCompanyWithMemberCount.mockResolvedValue(companyRow)
  })

  it('returns the company with its member count', async () => {
    const res = await GET({ request: makeRequest(), params: { companyId: COMPANY_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.id).toBe(COMPANY_ID)
    expect(json.data.memberCount).toBe(3)
    expect(json.data.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(mockGetCompanyWithMemberCount).toHaveBeenCalledWith(COMPANY_ID)
  })

  it('returns 400 for a malformed company ID', async () => {
    const res = await GET({ request: makeRequest(), params: { companyId: 'not-a-typeid' } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(mockGetCompanyWithMemberCount).not.toHaveBeenCalled()
  })

  it('returns 404 when the company does not exist', async () => {
    const { NotFoundError } = await import('@/lib/shared/errors')
    mockGetCompanyWithMemberCount.mockRejectedValue(
      new NotFoundError('COMPANY_NOT_FOUND', 'Company not found')
    )
    const res = await GET({ request: makeRequest(), params: { companyId: COMPANY_ID } })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('NOT_FOUND')
  })

  it('propagates auth failures', async () => {
    const { UnauthorizedError } = await import('@/lib/shared/errors')
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('UNAUTHORIZED', 'Invalid API key'))
    const res = await GET({ request: makeRequest(), params: { companyId: COMPANY_ID } })
    expect(res.status).toBe(401)
    expect(mockGetCompanyWithMemberCount).not.toHaveBeenCalled()
  })
})
