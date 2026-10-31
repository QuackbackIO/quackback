// @vitest-environment happy-dom
/**
 * RoadmapCard — the public roadmap board card.
 *
 * Covers the data contract that matters: the vote count and comment count
 * both render from the post data passed in, next to each other.
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to: _to,
    params: _params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
    [key: string]: unknown
  }) => <a {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>{children}</a>,
}))

vi.mock('@/components/public/portal-vote', () => ({
  PortalVote: ({ post }: { post: { id: string; board: { id: string } | null } }) => (
    <button type="button" data-board={post.board?.id}>
      vote
    </button>
  ),
}))

import { RoadmapCard } from '../roadmap-card'

afterEach(cleanup)

describe('RoadmapCard', () => {
  it('renders the vote count and comment count side by side', () => {
    render(
      <RoadmapCard
        id="post_1"
        title="Add dark mode"
        voteCount={42}
        commentCount={7}
        board={{ slug: 'general', name: 'General' }}
      />
    )

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('omits the comment count indicator when there are no comments', () => {
    render(
      <RoadmapCard
        id="post_2"
        title="Add light mode"
        voteCount={3}
        commentCount={0}
        board={{ slug: 'general', name: 'General' }}
      />
    )

    expect(screen.queryByTestId('roadmap-card-comment-count')).not.toBeInTheDocument()
  })

  it('votes beside the title’s link, not inside it, on the board the post is on', () => {
    render(
      <RoadmapCard
        id="post_3"
        title="Exports"
        voteCount={5}
        commentCount={0}
        board={{ id: 'board_1', slug: 'general', name: 'General' }}
        voting
      />
    )
    const vote = screen.getByRole('button', { name: 'vote' })
    expect(vote.getAttribute('data-board')).toBe('board_1')
    expect(vote.closest('a')).toBeNull()
    expect(screen.getByText('Exports').closest('a')).not.toBeNull()
  })
})
