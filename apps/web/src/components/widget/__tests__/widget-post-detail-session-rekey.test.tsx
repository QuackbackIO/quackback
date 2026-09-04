// @vitest-environment happy-dom
/**
 * GH #464 follow-up: a first-visit upload/reaction/comment mints the anonymous
 * session mid-action, which bumps sessionVersion and re-keys the post-detail
 * query. The detail view must keep the current post (and so the comment
 * editors and reaction chips) mounted while the Bearer refetch runs; a
 * skeleton here would unmount the editor the in-flight upload inserts into.
 * Switching to a different post still shows the skeleton.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const auth = { sessionVersion: 0 }
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    isIdentified: false,
    hmacRequired: false,
    user: null,
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    emitEvent: vi.fn(),
    sessionVersion: auth.sessionVersion,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
  generateOneTimeToken: async () => null,
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetImageUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('../widget-comment-list', () => ({ WidgetCommentList: () => null }))
vi.mock('../widget-comment-form', () => ({
  WidgetCommentForm: () => <div data-testid="comment-form" />,
}))
vi.mock('../widget-skeletons', () => ({
  WidgetPostDetailSkeleton: () => <div data-testid="skeleton" />,
}))
vi.mock('@/components/public/post-content', () => ({ PostContent: () => null }))
vi.mock('@/lib/client/mutations/load-more-comments', () => ({
  useLoadMoreWidgetComments: () => ({ loadMore: vi.fn(), isLoading: false, hasMore: false }),
}))

type Deferred = { resolve: (v: unknown) => void }
const pending: Deferred[] = []
const fetchPublicPostDetail = vi.fn(() => new Promise((resolve) => pending.push({ resolve })))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicPostDetail: (...args: unknown[]) => fetchPublicPostDetail(...(args as [])),
}))
vi.mock('@/lib/server/functions/comments', () => ({ createCommentFn: vi.fn() }))

import { WidgetPostDetail } from '../widget-post-detail'

const detail = (id: string, title: string) => ({
  id,
  title,
  content: '',
  contentJson: null,
  authorName: 'Ada',
  createdAt: '2026-07-30T10:00:00Z',
  voteCount: 1,
  statusId: null,
  board: { slug: 'ideas', name: 'Ideas' },
  comments: [],
  pinnedComment: null,
  pinnedCommentId: null,
  isCommentsLocked: false,
  canVote: true,
  canComment: true,
})

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('WidgetPostDetail — session re-key keeps the view mounted', () => {
  beforeEach(() => {
    auth.sessionVersion = 0
    pending.length = 0
    fetchPublicPostDetail.mockClear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('keeps the current post and comment form while the Bearer refetch is in flight', async () => {
    const { rerender } = render(<WidgetPostDetail postId="post_1" statuses={[]} />, { wrapper })
    expect(screen.getByTestId('skeleton')).toBeTruthy()
    await act(async () => pending[0].resolve(detail('post_1', 'First title')))
    await screen.findByText('First title')
    expect(screen.getByTestId('comment-form')).toBeTruthy()

    // A mid-action mint bumps sessionVersion → new query key, no cached data.
    auth.sessionVersion = 1
    rerender(<WidgetPostDetail postId="post_1" statuses={[]} />)
    await waitFor(() => expect(fetchPublicPostDetail).toHaveBeenCalledTimes(2))

    expect(screen.queryByTestId('skeleton')).toBeNull()
    expect(screen.getByText('First title')).toBeTruthy()
    expect(screen.getByTestId('comment-form')).toBeTruthy()

    await act(async () => pending[1].resolve(detail('post_1', 'Refetched title')))
    await screen.findByText('Refetched title')
  })

  it('still shows the skeleton when navigating to a different post', async () => {
    const { rerender } = render(<WidgetPostDetail postId="post_1" statuses={[]} />, { wrapper })
    await act(async () => pending[0].resolve(detail('post_1', 'First title')))
    await screen.findByText('First title')

    rerender(<WidgetPostDetail postId="post_2" statuses={[]} />)
    await waitFor(() => expect(fetchPublicPostDetail).toHaveBeenCalledTimes(2))

    expect(screen.getByTestId('skeleton')).toBeTruthy()
    expect(screen.queryByText('First title')).toBeNull()
  })
})
