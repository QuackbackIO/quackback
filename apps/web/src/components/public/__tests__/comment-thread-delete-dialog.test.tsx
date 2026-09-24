// @vitest-environment happy-dom
/**
 * CommentThread loads the delete confirmation the first time Delete is
 * pressed, not with the thread: most readers never delete anything. The
 * dialog module is stubbed to record when it loads and what it is asked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { PostCommentId, PostId, PrincipalId } from '@quackback/ids'

const dialogModule = vi.hoisted(() => ({ loaded: false }))

vi.mock('@/components/shared/confirm-dialog', () => {
  dialogModule.loaded = true
  return {
    ConfirmDialog: ({ open, title }: { open: boolean; title: string }) =>
      open ? <div role="alertdialog">{title}</div> : null,
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({
    settings: { name: 'Acme', brandingData: { logoUrl: null, name: 'Acme' } },
    session: null,
  }),
}))

vi.mock('../comment-form', () => ({ CommentForm: () => null }))

import { CommentThread } from '../comment-thread'

afterEach(cleanup)

const AUTHOR = 'principal_01h00000000000000000000000' as PrincipalId

const comment: PublicCommentView = {
  id: 'comment_a' as PostCommentId,
  content: 'Mine',
  contentJson: null,
  authorName: 'Ada',
  principalId: AUTHOR,
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

describe('CommentThread delete confirmation', () => {
  it('loads the dialog when Delete is first pressed', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}} onError={() => {}}>
          <CommentThread
            postId={'post_01h00000000000000000000000' as PostId}
            comments={[comment]}
            allowCommenting
            user={{ name: 'Ada', email: 'ada@example.com', principalId: AUTHOR }}
            onDeleteComment={vi.fn()}
          />
        </IntlProvider>
      </QueryClientProvider>
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(dialogModule.loaded).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alertdialog')).toHaveProperty(
      'textContent',
      'Delete this comment?'
    )
    expect(dialogModule.loaded).toBe(true)
  })
})
