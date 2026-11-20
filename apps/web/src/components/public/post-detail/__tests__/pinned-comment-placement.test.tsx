// @vitest-environment jsdom
/**
 * The pinned comment shows even when it is not among the root comments loaded
 * so far (the first page holds 30), and never twice: on the portal it joins
 * the thread, which floats it to the top; in the admin roadmap modal the card
 * is skipped when the thread below holds it.
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

import { withPinnedComment } from '@/lib/client/queries/portal-detail'
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

describe('withPinnedComment (portal post page)', () => {
  it('adds the pinned comment as a root when the thread has not loaded it', () => {
    const list = withPinnedComment([comment('comment_a'), comment('comment_b')], pinned)
    expect(list.map((c) => c.id)).toEqual(['comment_pinned', 'comment_a', 'comment_b'])
    expect(list[0]).toMatchObject({
      content: 'The answer is in settings',
      parentId: null,
      replies: [],
      reactions: [],
      deletedAt: null,
    })
  })

  it('leaves the thread as it is once it holds the pinned comment, as a root or a reply', () => {
    const roots = [comment('comment_a'), comment('comment_pinned')]
    expect(withPinnedComment(roots, pinned)).toBe(roots)
    const nested = [comment('comment_a', [comment('comment_pinned')])]
    expect(withPinnedComment(nested, pinned)).toBe(nested)
  })

  it('leaves the thread as it is when nothing is pinned', () => {
    const roots = [comment('comment_a')]
    expect(withPinnedComment(roots, null)).toBe(roots)
  })
})

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
