// @vitest-environment jsdom
/**
 * The admin roadmap modal shows the pinned comment once: its card is skipped
 * when the thread below holds the comment. (On the portal the server puts the
 * pinned comment in the thread itself: post-detail-pinned.db.test.ts.)
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

import { PinnedCommentSection } from '../official-response-section'

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

describe('PinnedCommentSection (admin roadmap modal)', () => {
  function renderSection(comments?: PublicCommentView[]) {
    return render(
      <IntlProvider locale="en">
        <PinnedCommentSection comment={pinned} workspaceName="Team" comments={comments} />
      </IntlProvider>
    )
  }

  it('shows nothing when the thread below already holds the pinned comment', () => {
    const { container } = renderSection([comment('comment_a'), comment('comment_pinned')])
    expect(container.textContent).toBe('')
  })

  it('shows the card when the thread does not hold it', async () => {
    renderSection([comment('comment_a')])
    expect(await screen.findByText('Pinned', {}, { timeout: 8000 })).toBeTruthy()
  })
})
