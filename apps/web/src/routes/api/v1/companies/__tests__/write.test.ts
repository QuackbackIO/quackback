import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyId, PrincipalId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockCreateCompany = vi.fn()
const mockUpdateCompany = vi.fn()
const mockAttachPrincipal = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/companies/company.service', () => ({
  createCompany: (...args: unknown[]) => mockCreateCompany(...args),
  updateCompany: (...args: unknown[]) => mockUpdateCompany(...args),
  attachPrincipal: (...args: unknown[]) => mockAttachPrincipal(...args),
  getCompanyWithMemberCount: async () => ({ ...companyRow, plan: 'pro', memberCount: 2 }),
}))

import { Route as ListRoute } from '../index'
import { Route as ItemRoute } from '../$companyId'
import { Route as MemberRoute } from '../$companyId.members.$principalId'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const handler = (route: unknown, method: string): Handler =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers[
    method
  ]

const KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId
const PRINCIPAL_ID = 'principal_01kqhxq697fvgat0h2def67890' as unknown as PrincipalId
const COMPANY_ID = 'company_01kqhxq697fvgat0h1abc12345' as unknown as CompanyId

const companyRow = {
  id: COMPANY_ID,
  name: 'Acme',
  domain: null,
  externalId: 'cust-1',
  plan: null,
  mrrCents: null,
  size: null,
  website: null,
  industry: null,
  source: 'api',
  customAttributes: {},
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.000Z'),
}

const jsonReq = (url: string, body: unknown, method: string) =>
  new Request(url, { method, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: KEY_PRINCIPAL, role: 'admin' })
  mockCreateCompany.mockResolvedValue(companyRow)
  mockUpdateCompany.mockResolvedValue({ ...companyRow, plan: 'pro' })
  mockAttachPrincipal.mockResolvedValue(undefined)
})

describe('POST /api/v1/companies', () => {
  const post = (body: unknown) =>
    handler(
      ListRoute,
      'POST'
    )({
      request: jsonReq('http://test/api/v1/companies', body, 'POST'),
      params: {},
    })

  it('creates a company with source api', async () => {
    const res = await post({ name: 'Acme', externalId: 'cust-1' })
    expect(res.status).toBe(201)
    expect((await res.json()).data.id).toBe(COMPANY_ID)
    expect(mockCreateCompany).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme', externalId: 'cust-1', source: 'api' })
    )
  })

  it('rejects a missing name', async () => {
    const res = await post({ externalId: 'cust-1' })
    expect(res.status).toBe(400)
    expect(mockCreateCompany).not.toHaveBeenCalled()
  })

  it('requires company.manage', async () => {
    await post({ name: 'Acme' })
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'company.manage',
    })
  })

  it('surfaces a duplicate domain as 409', async () => {
    const { ConflictError } = await import('@/lib/shared/errors')
    mockCreateCompany.mockRejectedValue(
      new ConflictError('COMPANY_DOMAIN_EXISTS', 'A company with that domain already exists')
    )
    const res = await post({ name: 'Acme', domain: 'acme.example' })
    expect(res.status).toBe(409)
  })
})

describe('PATCH /api/v1/companies/:companyId', () => {
  it('updates only the provided fields', async () => {
    const res = await handler(
      ItemRoute,
      'PATCH'
    )({
      request: jsonReq(`http://test/api/v1/companies/${COMPANY_ID}`, { plan: 'pro' }, 'PATCH'),
      params: { companyId: COMPANY_ID },
    })
    expect(res.status).toBe(200)
    expect(mockUpdateCompany).toHaveBeenCalledWith(COMPANY_ID, { plan: 'pro' })
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'company.manage',
    })
  })
})

describe('PUT /api/v1/companies/:companyId/members/:principalId', () => {
  const put = (principalId: string) =>
    handler(
      MemberRoute,
      'PUT'
    )({
      request: new Request(`http://test/api/v1/companies/${COMPANY_ID}/members/${principalId}`, {
        method: 'PUT',
      }),
      params: { companyId: COMPANY_ID, principalId },
    })

  it('attaches the principal', async () => {
    const res = await put(PRINCIPAL_ID)
    expect(res.status).toBe(204)
    expect(mockAttachPrincipal).toHaveBeenCalledWith(COMPANY_ID, PRINCIPAL_ID)
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'company.manage',
    })
  })

  it('rejects a malformed principal id', async () => {
    const res = await put('not-a-typeid')
    expect(res.status).toBe(400)
    expect(mockAttachPrincipal).not.toHaveBeenCalled()
  })
})
