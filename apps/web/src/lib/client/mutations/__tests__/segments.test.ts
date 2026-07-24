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

  it('invalidates the segments list after assigning users to a segment', async () => {
    const { useAssignUsersToSegment } = await import('../segments')
    const mutation = useAssignUsersToSegment() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'segments'] })
  })

  it('invalidates the single usersKeys tree that now backs the rendered list/detail', async () => {
    // QC-1 collapsed the old ['admin', 'users', filters] route suspense query
    // onto usersKeys.all (['users', ...]) — the same infinite definition the
    // list renders — so one invalidation of ['users'] keeps the visible
    // list/detail fresh. There is no longer a second ['admin', 'users'] tree
    // to hand-invalidate.
    const { useAssignUsersToSegment } = await import('../segments')
    const mutation = useAssignUsersToSegment() as { onSuccess?: () => void }

    mutation.onSuccess?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
  })
})
