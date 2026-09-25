// @vitest-environment happy-dom
/**
 * CommentThread mounts a comment's reply composer only once Reply is used.
 *
 * Every composer brings the rich-text editor with it, so a thread that
 * mounted a hidden reply form under each comment downloaded and ran the whole
 * editor for visitors who never reply. The composer is stubbed here so the
 * test counts composers, and which comment each one replies to, directly.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { PostCommentId, PostId } from '@quackback/ids'

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

vi.mock('../comment-form', () => ({
  CommentForm: ({ parentId }: { parentId?: string }) => (
    <div data-testid="composer" data-parent-id={parentId ?? 'root'} />
  ),
}))

import { CommentThread } from '../comment-thread'

afterEach(cleanup)

const POST_ID = 'post_01h00000000000000000000000' as PostId

function comment(id: string, content: string): PublicCommentView {
  return {
    id: id as PostCommentId,
    content,
    contentJson: null,
    authorName: 'Ada',
    principalId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    isRemovedByTeam: false,
    parentId: null,
    isTeamMember: false,
    isEdited: false,
    avatarUrl: null,
    replies: [],
    reactions: [],
  }
}

function renderThread() {
  const comments = [comment('comment_a', 'First'), comment('comment_b', 'Second')]
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CommentThread
          postId={POST_ID}
          comments={comments}
          allowCommenting
          user={{ name: 'Viewer', email: 'viewer@example.com' }}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

const composers = () =>
  screen.queryAllByTestId('composer').map((el) => el.getAttribute('data-parent-id'))

describe('CommentThread reply composers', () => {
  it('mounts only the top-level composer until a reply is started', () => {
    renderThread()
    expect(composers()).toEqual(['root'])
  })

  it('mounts a reply composer under the comment whose Reply was clicked, and keeps it', () => {
    renderThread()
    const second = document.getElementById('comment-comment_b')!
    const reply = within(second).getByTestId('reply-button')

    fireEvent.click(reply)
    expect(composers()).toEqual(['root', 'comment_b'])

    // Closing keeps it mounted so the collapse can animate.
    fireEvent.click(reply)
    expect(composers()).toEqual(['root', 'comment_b'])
  })
})
