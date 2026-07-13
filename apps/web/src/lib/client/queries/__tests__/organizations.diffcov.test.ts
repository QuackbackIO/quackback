import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  listOrganizationsFn: vi.fn(),
  getOrganizationFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/organizations', () => ({
  listOrganizationsFn: (input: unknown) => mocks.listOrganizationsFn(input),
  getOrganizationFn: (input: unknown) => mocks.getOrganizationFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
}))

import { organizationQueries } from '../organizations'

const organizationId = 'org_1' as OrganizationId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('organizationQueries.all', () => {
  it('exposes the root key', () => {
    expect(organizationQueries.all).toEqual(['organizations'])
  })
})

describe('organizationQueries.list', () => {
  it('defaults to empty filters and omits a blank search', async () => {
    const options = organizationQueries.list()
    expect(options.queryKey).toEqual(['organizations', 'list', {}])
    expect(options.staleTime).toBe(30_000)

    mocks.listOrganizationsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listOrganizationsFn).toHaveBeenCalledWith({
      data: { search: undefined, includeArchived: undefined, limit: 200 },
    })
  })

  it('collapses a whitespace-only search to undefined', async () => {
    const options = organizationQueries.list({ search: '   ' })

    mocks.listOrganizationsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listOrganizationsFn).toHaveBeenCalledWith({
      data: { search: undefined, includeArchived: undefined, limit: 200 },
    })
  })

  it('trims a populated search and forwards includeArchived', async () => {
    const filters = { search: '  acme  ', includeArchived: true }
    const options = organizationQueries.list(filters)
    expect(options.queryKey).toEqual(['organizations', 'list', filters])

    mocks.listOrganizationsFn.mockResolvedValueOnce([{ id: organizationId }])
    await options.queryFn!({} as never)

    expect(mocks.listOrganizationsFn).toHaveBeenCalledWith({
      data: { search: 'acme', includeArchived: true, limit: 200 },
    })
  })
})

describe('organizationQueries.detail', () => {
  it('builds the detail query and calls getOrganizationFn', async () => {
    const options = organizationQueries.detail(organizationId)
    expect(options.queryKey).toEqual(['organizations', 'detail', organizationId])

    mocks.getOrganizationFn.mockResolvedValueOnce({ id: organizationId })
    await options.queryFn!({} as never)

    expect(mocks.getOrganizationFn).toHaveBeenCalledWith({ data: { organizationId } })
  })
})
