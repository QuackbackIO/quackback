// @vitest-environment happy-dom
/**
 * <ArticleFeedbackReasonsDialog> — the admin-side read of what visitors wrote
 * when they voted an article unhelpful.
 *
 * The list is the whole point of the surface, so the tests pin what an admin
 * sees: the words themselves, newest first, and an honest empty state when a
 * thumbs-down carried no explanation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KbArticleId } from '@quackback/ids'

const listReasons = vi.fn()

vi.mock('@/lib/server/functions/help-center', () => ({
  listArticleFeedbackReasonsFn: (input: { data: unknown }) => listReasons(input),
}))

import { ArticleFeedbackReasonsDialog } from '../article-feedback-reasons-dialog'

beforeEach(() => {
  listReasons.mockReset()
})

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ArticleFeedbackReasonsDialog
        articleId={'kb_article_1' as KbArticleId}
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>
  )
}

describe('ArticleFeedbackReasonsDialog', () => {
  it('shows the reasons visitors wrote, in the order the server returned', async () => {
    listReasons.mockResolvedValue([
      {
        id: 'kb_article_feedback_2',
        reason: 'The screenshots are out of date',
        createdAt: '2024-03-02T00:00:00.000Z',
      },
      {
        id: 'kb_article_feedback_1',
        reason: 'Missing the CLI flag',
        createdAt: '2024-03-01T00:00:00.000Z',
      },
    ])

    renderDialog()

    await waitFor(() => expect(screen.getByText('The screenshots are out of date')).toBeTruthy())
    expect(screen.getByText('Missing the CLI flag')).toBeTruthy()

    const rendered = screen.getAllByTestId('article-feedback-reason').map((el) => el.textContent)
    expect(rendered[0]).toContain('The screenshots are out of date')
    expect(rendered[1]).toContain('Missing the CLI flag')

    expect(listReasons).toHaveBeenCalledWith({ data: { articleId: 'kb_article_1' } })
  })

  it('says so when no unhelpful vote came with an explanation', async () => {
    listReasons.mockResolvedValue([])

    renderDialog()

    await waitFor(() => expect(screen.getByText(/no one has explained/i)).toBeTruthy())
    expect(screen.queryAllByTestId('article-feedback-reason')).toHaveLength(0)
  })
})
