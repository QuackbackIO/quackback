// @vitest-environment happy-dom
/**
 * A reaction on the pinned comment toggles on and off, and the thread keeps
 * what the server answered across re-renders: the pinned comment is a thread
 * comment from the detail cache (its reactions are the cached ones), so a
 * parent re-render with the same thread does not reset them.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { PostCommentId, PostId, PrincipalId } from '@quackback/ids'

const calls = vi.hoisted(() => ({ add: 0, remove: 0 }))

vi.mock('@/lib/server/functions/comments', () => ({
  addReactionFn: vi.fn(async () => {
    calls.add++
    return { added: true, reactions: [{ emoji: '👍', count: 2, hasReacted: true }] }
  }),
  removeReactionFn: vi.fn(async () => {
    calls.remove++
    return { added: false, reactions: [{ emoji: '👍', count: 1, hasReacted: false }] }
  }),
  getCommentPermissionsFn: vi.fn(async () => ({ canEdit: false, canDelete: false })),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = {
      settings: { name: 'Acme', brandingData: { logoUrl: null, name: 'Acme' } },
      session: null,
    }
    return opts?.select ? opts.select(context as never) : context
  },
}))
vi.mock('../comment-form', () => ({ CommentForm: () => null }))

import { CommentThread } from '../comment-thread'

afterEach(() => {
  cleanup()
  calls.add = 0
  calls.remove = 0
})

const pinned: PublicCommentView = {
  id: 'comment_pinned' as PostCommentId,
  content: 'The answer',
  contentJson: null,
  authorName: 'Tess',
  principalId: 'principal_01h00000000000000000000001' as PrincipalId,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  isRemovedByTeam: false,
  parentId: null,
  isTeamMember: true,
  isEdited: false,
  avatarUrl: null,
  replies: [],
  reactions: [{ emoji: '👍', count: 1, hasReacted: false }],
}

describe('a reaction on the pinned comment', () => {
  it('toggles on and off and survives a re-render of the same thread', async () => {
    const comments = [pinned]
    const client = new QueryClient()
    const tree = () => (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={{}} onError={() => {}}>
          <CommentThread
            postId={'post_01h00000000000000000000000' as PostId}
            comments={comments}
            pinnedCommentId={pinned.id}
            allowCommenting
            user={{
              name: 'Ada',
              email: 'ada@example.com',
              principalId: 'principal_01h00000000000000000000000' as PrincipalId,
            }}
          />
        </IntlProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(tree())

    fireEvent.click(screen.getByText('👍'))
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy())
    rerender(tree())
    expect(screen.getByText('2')).toBeTruthy()

    fireEvent.click(screen.getByText('👍'))
    await waitFor(() => expect(screen.getByText('1')).toBeTruthy())
    expect(calls).toEqual({ add: 1, remove: 1 })
  })
})
