import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockEq: vi.fn(),
  mockAnd: vi.fn(),
  mockOr: vi.fn(),
  mockIlike: vi.fn(),
  mockInArray: vi.fn(),
  mockNotInArray: vi.fn(),
  mockDesc: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => hoisted.mockRequireAuth(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => hoisted.mockSelect(...args),
  },
  principal: {
    id: 'principal.id',
    displayName: 'principal.displayName',
    avatarUrl: 'principal.avatarUrl',
    role: 'principal.role',
    type: 'principal.type',
    userId: 'principal.userId',
    createdAt: 'principal.createdAt',
  },
  user: {
    id: 'user.id',
    email: 'user.email',
    name: 'user.name',
  },
  eq: (...args: unknown[]) => hoisted.mockEq(...args),
  and: (...args: unknown[]) => hoisted.mockAnd(...args),
  or: (...args: unknown[]) => hoisted.mockOr(...args),
  ilike: (...args: unknown[]) => hoisted.mockIlike(...args),
  inArray: (...args: unknown[]) => hoisted.mockInArray(...args),
  notInArray: (...args: unknown[]) => hoisted.mockNotInArray(...args),
  desc: (...args: unknown[]) => hoisted.mockDesc(...args),
}))

await import('../principals')

const [searchPrincipalsFn, getPrincipalsByIdsFn] = handlersByIndex

if (!getPrincipalsByIdsFn) {
  throw new Error(`principal handlers were not registered; found ${handlersByIndex.length}`)
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'principal_agent',
    displayName: 'Agent',
    avatarUrl: null,
    role: 'member',
    type: 'user',
    userId: 'user_agent',
    userEmail: 'agent@example.com',
    userName: 'Ada Agent',
    ...overrides,
  }
}

function searchChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  }
  return chain
}

function byIdChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(rows)),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({ user: { id: 'user_admin' } })
  hoisted.mockEq.mockImplementation((left, right) => ({ op: 'eq', left, right }))
  hoisted.mockAnd.mockImplementation((...parts) => ({ op: 'and', parts }))
  hoisted.mockOr.mockImplementation((...parts) => ({ op: 'or', parts }))
  hoisted.mockIlike.mockImplementation((left, right) => ({ op: 'ilike', left, right }))
  hoisted.mockInArray.mockImplementation((left, values) => ({ op: 'inArray', left, values }))
  hoisted.mockNotInArray.mockImplementation((left, values) => ({ op: 'notInArray', left, values }))
  hoisted.mockDesc.mockImplementation((column) => ({ op: 'desc', column }))
})

describe('principal server functions', () => {
  it('searches principals with role, exclusion, query, and limit filters', async () => {
    const chain = searchChain([
      row({ displayName: null, userName: 'Ada User', userEmail: null, userId: null }),
    ])
    hoisted.mockSelect.mockReturnValueOnce(chain)

    const result = await searchPrincipalsFn({
      data: {
        query: '  ada  ',
        roleFilter: ['member'],
        excludeIds: ['principal_skip'],
        limit: 5,
      },
    })

    expect(result).toEqual([
      {
        id: 'principal_agent',
        displayName: 'Ada User',
        email: null,
        role: 'member',
        avatarUrl: null,
        type: 'user',
        userId: null,
      },
    ])
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin', 'member', 'user'] })
    expect(hoisted.mockInArray).toHaveBeenCalledWith('principal.role', ['member'])
    expect(hoisted.mockNotInArray).toHaveBeenCalledWith('principal.id', ['principal_skip'])
    expect(hoisted.mockIlike).toHaveBeenCalledWith('principal.displayName', '%ada%')
    expect(chain.where).toHaveBeenCalledWith(expect.objectContaining({ op: 'and' }))
    expect(chain.limit).toHaveBeenCalledWith(5)
  })

  it('searches principals with no optional filters and the default limit', async () => {
    const chain = searchChain([row()])
    hoisted.mockSelect.mockReturnValueOnce(chain)

    await expect(searchPrincipalsFn({ data: {} })).resolves.toEqual([
      {
        id: 'principal_agent',
        displayName: 'Agent',
        email: 'agent@example.com',
        role: 'member',
        avatarUrl: null,
        type: 'user',
        userId: 'user_agent',
      },
    ])

    expect(chain.where).toHaveBeenCalledWith(undefined)
    expect(chain.limit).toHaveBeenCalledWith(20)
  })

  it('fetches principals by ids and maps nullable user ids', async () => {
    const chain = byIdChain([row({ userId: null })])
    hoisted.mockSelect.mockReturnValueOnce(chain)

    await expect(getPrincipalsByIdsFn({ data: { ids: ['principal_agent'] } })).resolves.toEqual([
      {
        id: 'principal_agent',
        displayName: 'Agent',
        email: 'agent@example.com',
        role: 'member',
        avatarUrl: null,
        type: 'user',
        userId: null,
      },
    ])
    expect(hoisted.mockInArray).toHaveBeenCalledWith('principal.id', ['principal_agent'])
  })

  it('does not query principals when authentication fails', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('login required'))

    await expect(searchPrincipalsFn({ data: {} })).rejects.toThrow('login required')

    expect(hoisted.mockSelect).not.toHaveBeenCalled()
  })
})
