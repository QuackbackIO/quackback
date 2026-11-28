import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateQueries = vi.fn()
const setQueryData = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: unknown) => options),
  useQueryClient: vi.fn(() => ({ invalidateQueries, setQueryData })),
}))

vi.mock('@/lib/server/functions/help-center', () => ({}))

describe('saving an article', () => {
  beforeEach(() => vi.clearAllMocks())

  it("refreshes the editor's language bar, which a text change can leave behind", async () => {
    const { useUpdateArticle } = await import('../help-center')
    const mutation = useUpdateArticle() as unknown as { onSuccess: (data: { id: string }) => void }

    mutation.onSuccess({ id: 'article_1' })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['help-center', 'article-languages', 'article_1'],
    })
  })
})
