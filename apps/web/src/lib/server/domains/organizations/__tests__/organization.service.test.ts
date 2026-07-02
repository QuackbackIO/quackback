/**
 * Focused unit tests for organization.service that exercise validation and
 * dedupe paths. Heavy-chained query mocks are avoided — those paths are
 * covered by integration tests later in the rollout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const updateReturningMock = vi.fn()
const selectMock = vi.fn()

vi.mock('@/lib/server/db', () => {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: insertReturningMock,
  }
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: updateReturningMock,
  }
  return {
    db: {
      query: { organizations: { findFirst: findFirstMock } },
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      select: selectMock,
    },
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    ilike: vi.fn(),
    isNull: vi.fn(),
    asc: vi.fn(),
    desc: vi.fn(),
    organizations: {
      id: 'organizations.id',
      domain: 'organizations.domain',
      externalId: 'organizations.external_id',
    },
  }
})

vi.mock('@/lib/shared/errors', () => ({
  ConflictError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
  NotFoundError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
  ValidationError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  findFirstMock.mockReset()
  insertReturningMock.mockReset()
  updateReturningMock.mockReset()
  selectMock.mockReset()
})

function makeListChain(rows: unknown[]) {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return chain
}

describe('createOrganization', () => {
  it('throws ValidationError when name is empty', async () => {
    const { createOrganization } = await import('../organization.service')
    await expect(createOrganization({ name: '   ' })).rejects.toThrow(/name is required/i)
  })

  it('throws ValidationError when domain is malformed', async () => {
    const { createOrganization } = await import('../organization.service')
    await expect(createOrganization({ name: 'Acme', domain: 'not a domain' })).rejects.toThrow(
      /domain is invalid/i
    )
  })

  it('throws ConflictError when domain already exists', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'org_existing', domain: 'acme.com' })
    const { createOrganization } = await import('../organization.service')
    await expect(createOrganization({ name: 'Acme', domain: 'ACME.com' })).rejects.toThrow(
      /already exists/i
    )
  })

  it('inserts with normalised domain on success', async () => {
    findFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValueOnce([{ id: 'org_new', name: 'Acme', domain: 'acme.com' }])
    const { createOrganization } = await import('../organization.service')
    const result = await createOrganization({ name: '  Acme  ', domain: 'ACME.COM' })
    expect(result.id).toBe('org_new')
  })
})

describe('findOrCreateByDomain', () => {
  it('returns the existing organization when one matches', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'org_existing', domain: 'acme.com' })
    const { findOrCreateByDomain } = await import('../organization.service')
    const result = await findOrCreateByDomain('https://ACME.com/')
    expect(result.id).toBe('org_existing')
  })

  it('inserts a new organization when none exists', async () => {
    findFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([
      { id: 'org_new', domain: 'acme.com', name: 'acme.com' },
    ])
    const { findOrCreateByDomain } = await import('../organization.service')
    const result = await findOrCreateByDomain('acme.com')
    expect(result.id).toBe('org_new')
  })

  it('rejects invalid domain inputs', async () => {
    const { findOrCreateByDomain } = await import('../organization.service')
    await expect(findOrCreateByDomain('garbage')).rejects.toThrow(/invalid/i)
  })
})

describe('listOrganizations', () => {
  it('applies search, archived filtering, capped limits, and clamped offsets', async () => {
    const rows = [{ id: 'org_1', name: 'Acme', domain: 'acme.com' }]
    const chain = makeListChain(rows)
    selectMock.mockReturnValueOnce(chain)

    const { listOrganizations } = await import('../organization.service')
    await expect(listOrganizations({ search: ' acme ', limit: 500, offset: -50 })).resolves.toEqual(
      rows
    )

    expect(chain.limit).toHaveBeenCalledWith(200)
    expect(chain.offset).toHaveBeenCalledWith(0)
  })

  it('can list archived organizations without a where clause', async () => {
    const chain = makeListChain([])
    selectMock.mockReturnValueOnce(chain)

    const { listOrganizations } = await import('../organization.service')
    await expect(listOrganizations({ includeArchived: true })).resolves.toEqual([])

    expect(chain.where).toHaveBeenCalledWith(undefined)
  })
})
