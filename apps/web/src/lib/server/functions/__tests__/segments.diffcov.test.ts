import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      inputValidator() {
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

const mockRequireAuth = vi.fn()
vi.mock('../auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockFindMany = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      segments: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
  segments: { deletedAt: 'segments.deletedAt' },
  isNull: (col: unknown) => ({ isNull: col }),
}))

// Index 0 in segments.ts is listSegmentsFn.
const LIST_SEGMENTS = 0
let listSegmentsHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../segments')
  }
  listSegmentsHandler = handlersByIndex[LIST_SEGMENTS]
})

describe('listSegmentsFn', () => {
  it('requires admin role and returns the active segments', async () => {
    mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
    const rows = [
      {
        id: 'seg_1',
        name: 'Alpha',
        slug: 'alpha',
        description: null,
        type: 'dynamic',
        color: '#fff',
      },
    ]
    mockFindMany.mockResolvedValue(rows)

    const result = await listSegmentsHandler()

    expect(mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin'] })
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(result).toBe(rows)
  })

  it('rethrows when the auth check rejects', async () => {
    const authError = new Error('Unauthorized')
    mockRequireAuth.mockRejectedValue(authError)

    await expect(listSegmentsHandler()).rejects.toThrow('Unauthorized')
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('rethrows when the query fails', async () => {
    mockRequireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
    mockFindMany.mockRejectedValue(new Error('db down'))

    await expect(listSegmentsHandler()).rejects.toThrow('db down')
  })
})
