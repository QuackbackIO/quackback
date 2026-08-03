import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactId, OrganizationId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  searchContactsFn: vi.fn(),
  listContactsForOrganizationFn: vi.fn(),
  getContactFn: vi.fn(),
  listLinksForContactFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/contacts', () => ({
  searchContactsFn: (input: unknown) => mocks.searchContactsFn(input),
  listContactsForOrganizationFn: (input: unknown) => mocks.listContactsForOrganizationFn(input),
  getContactFn: (input: unknown) => mocks.getContactFn(input),
  listLinksForContactFn: (input: unknown) => mocks.listLinksForContactFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
}))

import { contactQueries } from '../contacts'

const orgId = 'organization_1' as OrganizationId
const contactId = 'contact_1' as ContactId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('contactQueries.all', () => {
  it('exposes the root key', () => {
    expect(contactQueries.all).toEqual(['contacts'])
  })
})

describe('contactQueries.search', () => {
  it('defaults to an empty filter object and omits blank query/email', async () => {
    const options = contactQueries.search()
    expect(options.queryKey).toEqual(['contacts', 'search', {}])
    expect(options.staleTime).toBe(30_000)

    mocks.searchContactsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.searchContactsFn).toHaveBeenCalledWith({
      data: {
        query: undefined,
        email: undefined,
        organizationId: undefined,
        includeArchived: undefined,
        limit: 100,
      },
    })
  })

  it('trims and forwards a populated query, email and organization filter', async () => {
    const filters = {
      query: '  alice  ',
      email: '  a@b.com  ',
      organizationId: orgId,
      includeArchived: true,
    }
    const options = contactQueries.search(filters)
    expect(options.queryKey).toEqual(['contacts', 'search', filters])

    mocks.searchContactsFn.mockResolvedValueOnce([{ id: contactId }])
    await options.queryFn!({} as never)

    expect(mocks.searchContactsFn).toHaveBeenCalledWith({
      data: {
        query: 'alice',
        email: 'a@b.com',
        organizationId: orgId,
        includeArchived: true,
        limit: 100,
      },
    })
  })

  it('collapses whitespace-only query/email to undefined', async () => {
    const options = contactQueries.search({ query: '   ', email: '   ' })

    mocks.searchContactsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.searchContactsFn).toHaveBeenCalledWith({
      data: {
        query: undefined,
        email: undefined,
        organizationId: undefined,
        includeArchived: undefined,
        limit: 100,
      },
    })
  })
})

describe('contactQueries.byOrg', () => {
  it('builds the org-scoped query with default filters', async () => {
    const options = contactQueries.byOrg(orgId)
    expect(options.queryKey).toEqual(['contacts', 'byOrg', orgId, {}])
    expect(options.staleTime).toBe(30_000)

    mocks.listContactsForOrganizationFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listContactsForOrganizationFn).toHaveBeenCalledWith({
      data: { organizationId: orgId, includeArchived: undefined, limit: 200 },
    })
  })

  it('forwards includeArchived when provided', async () => {
    const options = contactQueries.byOrg(orgId, { includeArchived: true })
    expect(options.queryKey).toEqual(['contacts', 'byOrg', orgId, { includeArchived: true }])

    mocks.listContactsForOrganizationFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listContactsForOrganizationFn).toHaveBeenCalledWith({
      data: { organizationId: orgId, includeArchived: true, limit: 200 },
    })
  })
})

describe('contactQueries.detail', () => {
  it('builds the detail query and calls getContactFn', async () => {
    const options = contactQueries.detail(contactId)
    expect(options.queryKey).toEqual(['contacts', 'detail', contactId])
    expect(options.staleTime).toBe(30_000)

    mocks.getContactFn.mockResolvedValueOnce({ id: contactId })
    await options.queryFn!({} as never)

    expect(mocks.getContactFn).toHaveBeenCalledWith({ data: { contactId } })
  })
})

describe('contactQueries.links', () => {
  it('builds the links query and calls listLinksForContactFn', async () => {
    const options = contactQueries.links(contactId)
    expect(options.queryKey).toEqual(['contacts', 'links', contactId])
    expect(options.staleTime).toBe(30_000)

    mocks.listLinksForContactFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listLinksForContactFn).toHaveBeenCalledWith({ data: { contactId } })
  })
})
