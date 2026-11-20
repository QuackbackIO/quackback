// @vitest-environment jsdom
/**
 * The pinned comment shows on the post page even when it is not among the
 * root comments loaded so far (the first page holds 30). Once it is loaded,
 * the thread floats it to the top itself, so it is not shown twice.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { PostCommentId } from '@quackback/ids'
import type { PinnedCommentView, PublicCommentView } from '@/lib/client/queries/portal-detail'

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { settings: { brandingData: { logoUrl: null, name: 'Acme' }, name: 'Acme' } }
    return opts?.select ? opts.select(context as never) : context
  },
}))

import { ThreadPinnedComment } from '../official-response-section'

const pinned: PinnedCommentView = {
  id: 'comment_pinned' as PostCommentId,
  content: 'The answer is in settings',
  contentJson: null,
  authorName: 'Ada',
  principalId: null,
  avatarUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  isTeamMember: true,
}

function comment(id: string, replies: PublicCommentView[] = []): PublicCommentView {
  return {
    id: id as PostCommentId,
    content: id,
    authorName: 'Someone',
    principalId: null,
    createdAt: new Date().toISOString(),
    isTeamMember: false,
    parentId: null,
    replies,
    reactions: [],
  } as unknown as PublicCommentView
}

function renderPinned(comments: PublicCommentView[]) {
  return render(
    <IntlProvider locale="en">
      <ThreadPinnedComment pinnedComment={pinned} comments={comments} workspaceName="Acme" />
    </IntlProvider>
  )
}

describe('ThreadPinnedComment', () => {
  it('shows the pinned comment when it is not among the loaded comments', () => {
    renderPinned([comment('comment_a'), comment('comment_b')])
    expect(screen.getByText('The answer is in settings')).toBeTruthy()
    expect(screen.getByText('Pinned')).toBeTruthy()
  })

  it('shows nothing once the thread has loaded it as a root comment', () => {
    const { container } = renderPinned([comment('comment_a'), comment('comment_pinned')])
    expect(container.textContent).toBe('')
  })

  it('shows nothing when the thread has loaded it as a reply', () => {
    const { container } = renderPinned([comment('comment_a', [comment('comment_pinned')])])
    expect(container.textContent).toBe('')
  })
})
