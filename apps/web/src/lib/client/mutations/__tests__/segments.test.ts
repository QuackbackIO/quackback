import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: unknown) => options),
  useQueryClient: vi.fn(() => ({
    invalidateQueries,
  })),
}))

vi.mock('@/lib/server/functions/admin', () => ({
  createSegmentFn: vi.fn(),
  updateSegmentFn: vi.fn(),
  deleteSegmentFn: vi.fn(),
  assignUsersToSegmentFn: vi.fn(),
  removeUsersFromSegmentFn: vi.fn(),
  evaluateSegmentFn: vi.fn(),
  evaluateAllSegmentsFn: vi.fn(),
}))

describe('segment mutations cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates admin users queries after assigning users to a segment', async () => {
    const { useAssignUsersToSegment } = await import('../segments')
    const mutation = useAssignUsersToSegment() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'segments'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
  })
})
