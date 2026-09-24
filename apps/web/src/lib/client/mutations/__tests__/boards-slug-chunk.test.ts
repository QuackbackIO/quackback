/**
 * The optimistic board row loads slugify on demand. A tab still running an
 * older build can fail to fetch that chunk after a deploy; creating the board
 * must not depend on it, since the server derives the real slug anyway.
 */
import { describe, expect, it, vi } from 'vitest'

const setQueryData = vi.fn()

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: vi.fn((options: unknown) => options),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
      cancelQueries: vi.fn(),
      getQueryData: vi.fn(),
      setQueryData,
      removeQueries: vi.fn(),
    })),
  }
})

vi.mock('@/lib/server/functions/boards', () => ({
  createBoardFn: vi.fn(),
  updateBoardFn: vi.fn(),
  deleteBoardFn: vi.fn(),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    boardsForSettings: () => ({ queryKey: ['admin', 'settings', 'boards'] }),
    boardsWithCounts: () => ({ queryKey: ['admin', 'boards', 'with-counts'] }),
  },
}))

vi.mock('@/lib/shared/utils/slugify', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

describe('useCreateBoard optimistic row', () => {
  it('still adds the row, with a placeholder slug, when slugify fails to load', async () => {
    const { useCreateBoard } = await import('../boards')
    const mutation = useCreateBoard() as {
      onMutate?: (input: { name: string }) => Promise<unknown>
    }

    await expect(mutation.onMutate?.({ name: 'Feature Requests' })).resolves.toBeDefined()

    const updater = setQueryData.mock.calls[0]![1] as (old: unknown[] | undefined) => unknown[]
    expect(updater([])[0]).toMatchObject({ name: 'Feature Requests', slug: '' })
  })
})
