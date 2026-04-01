import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()
const cancelQueries = vi.fn()
const getQueryData = vi.fn()
const setQueryData = vi.fn()
const removeQueries = vi.fn()

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: vi.fn((options: unknown) => options),
    useQueryClient: vi.fn(() => ({
      invalidateQueries,
      cancelQueries,
      getQueryData,
      setQueryData,
      removeQueries,
    })),
  }
})

vi.mock('@/lib/server/functions/boards', () => ({
  createBoardFn: vi.fn(),
  updateBoardFn: vi.fn(),
  deleteBoardFn: vi.fn(),
}))

// Mock the admin queries to return a known queryKey
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    boardsForSettings: () => ({
      queryKey: ['admin', 'settings', 'boards'],
    }),
  },
}))

describe('board mutations cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('useCreateBoard.onSettled invalidates both board list and admin settings caches', async () => {
    const { useCreateBoard } = await import('../boards')
    const mutation = useCreateBoard() as { onSettled?: () => void }

    mutation.onSettled?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['boards', 'list'] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'settings', 'boards'],
    })
  })

  it('useUpdateBoard.onSettled invalidates board list, detail, and admin settings caches', async () => {
    const { useUpdateBoard } = await import('../boards')
    const mutation = useUpdateBoard() as {
      onSettled?: (_data: unknown, _error: unknown, input: { id: string }) => void
    }

    mutation.onSettled?.(undefined, undefined, { id: 'board_test123' })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['boards', 'list'] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['boards', 'detail', 'board_test123'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'settings', 'boards'],
    })
  })

  it('useDeleteBoard.onSettled invalidates both board list and admin settings caches', async () => {
    const { useDeleteBoard } = await import('../boards')
    const mutation = useDeleteBoard() as { onSettled?: () => void }

    mutation.onSettled?.()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['boards', 'list'] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'settings', 'boards'],
    })
  })

  it('useCreateBoard.onMutate generates correct optimistic slug', async () => {
    const { useCreateBoard } = await import('../boards')
    const mutation = useCreateBoard() as {
      onMutate?: (input: { name: string; description?: string; isPublic?: boolean }) => void
    }

    await mutation.onMutate?.({ name: 'Feature Requests' })

    expect(setQueryData).toHaveBeenCalled()
    const setCall = setQueryData.mock.calls.find(
      (call: unknown[]) => JSON.stringify(call[0]) === JSON.stringify(['boards', 'list'])
    )
    expect(setCall).toBeDefined()

    // Call the updater function to get the optimistic board
    const updater = setCall![1] as (old: unknown[] | undefined) => unknown[]
    const result = updater([])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Feature Requests',
      slug: 'feature-requests',
    })
  })

  it('useCreateBoard.onMutate handles Cyrillic names in optimistic slug', async () => {
    const { useCreateBoard } = await import('../boards')
    const mutation = useCreateBoard() as {
      onMutate?: (input: { name: string; description?: string; isPublic?: boolean }) => void
    }

    await mutation.onMutate?.({ name: 'Кириллица' })

    const setCall = setQueryData.mock.calls.find(
      (call: unknown[]) => JSON.stringify(call[0]) === JSON.stringify(['boards', 'list'])
    )
    const updater = setCall![1] as (old: unknown[] | undefined) => unknown[]
    const result = updater([])
    expect(result[0]).toMatchObject({
      name: 'Кириллица',
      slug: 'kirillica',
    })
  })
})
