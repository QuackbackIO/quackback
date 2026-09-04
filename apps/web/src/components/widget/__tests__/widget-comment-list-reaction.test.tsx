// @vitest-environment happy-dom
/**
 * GH #464 (same class): toggling a comment reaction can be a first-time
 * visitor's first write, so the widget must establish a session before
 * calling the reaction server fn — which requireAuth()s — or the request goes
 * out with no Bearer and is rejected silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PostCommentId } from '@quackback/ids'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'

const session = { token: null as string | null, version: 0 }
const calls: string[] = []

const ensureSessionThen = vi.fn(async (cb: () => void | Promise<void>) => {
  calls.push('ensureSession')
  if (!session.token) {
    session.token = 'anon-minted'
    session.version += 1
  }
  await cb()
})

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ ensureSessionThen, getSessionVersion: () => session.version }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => (session.token ? { Authorization: `Bearer ${session.token}` } : {}),
}))

const addReactionFn = vi.fn(async () => {
  calls.push('addReaction')
  return { added: true, reactions: [{ emoji: '👍', count: 2, hasReacted: true, reactors: [] }] }
})
vi.mock('@/lib/server/functions/comments', () => ({
  addReactionFn: (...args: unknown[]) => addReactionFn(...(args as [])),
  removeReactionFn: vi.fn(),
}))
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }))
vi.mock('@/components/public/comment-content', () => ({
  CommentContent: ({ content }: { content: string }) => <p>{content}</p>,
}))

import { WidgetCommentList } from '../widget-comment-list'

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

const comment: PublicCommentView = {
  id: 'pcm_1' as PostCommentId,
  content: 'Nice idea',
  contentJson: null,
  authorName: 'Ada',
  principalId: 'prn_ada',
  createdAt: '2026-07-30T10:00:00Z',
  deletedAt: null,
  isRemovedByTeam: false,
  parentId: null,
  isTeamMember: false,
  isEdited: false,
  avatarUrl: null,
  replies: [],
  reactions: [{ emoji: '👍', count: 1, hasReacted: false, reactors: [] }],
}

describe('WidgetCommentList — reaction session guard (GH #464)', () => {
  beforeEach(() => {
    session.token = null
    session.version = 0
    calls.length = 0
    ensureSessionThen.mockClear()
    addReactionFn.mockClear()
    queryClient = new QueryClient()
  })

  it('mints a session before firing the reaction and sends the Bearer', async () => {
    render(<WidgetCommentList comments={[comment]} pinnedCommentId={null} />, { wrapper })

    fireEvent.click(screen.getByTestId('reaction-badge'))

    await waitFor(() => expect(addReactionFn).toHaveBeenCalledTimes(1))
    expect(calls).toEqual(['ensureSession', 'addReaction'])
    expect(addReactionFn).toHaveBeenCalledWith({
      data: { commentId: 'pcm_1', emoji: '👍' },
      headers: { Authorization: 'Bearer anon-minted' },
    })
    // Server result replaces the optimistic state.
    await waitFor(() => expect(screen.getByTestId('reaction-badge').textContent).toContain('2'))
  })

  it('refetches the post detail when the reaction minted the session (re-key race)', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    render(<WidgetCommentList comments={[comment]} pinnedCommentId={null} />, { wrapper })

    fireEvent.click(screen.getByTestId('reaction-badge'))

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['widget', 'post'] }))
  })

  it('does not refetch the post detail when a session already existed', async () => {
    session.token = 'anon-existing'
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    render(<WidgetCommentList comments={[comment]} pinnedCommentId={null} />, { wrapper })

    fireEvent.click(screen.getByTestId('reaction-badge'))

    await waitFor(() => expect(addReactionFn).toHaveBeenCalledTimes(1))
    expect(addReactionFn).toHaveBeenCalledWith({
      data: { commentId: 'pcm_1', emoji: '👍' },
      headers: { Authorization: 'Bearer anon-existing' },
    })
    await waitFor(() => expect(screen.getByTestId('reaction-badge').textContent).toContain('2'))
    expect(invalidate).not.toHaveBeenCalled()
  })
})
