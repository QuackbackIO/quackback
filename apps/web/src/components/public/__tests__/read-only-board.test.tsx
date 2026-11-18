// @vitest-environment happy-dom
/**
 * A read-only board in the portal: a quiet note in place of the composer, votes
 * shown and closed, and never a word about plans or billing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { PostId, PostStatusId } from '@quackback/ids'

const handleVote = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    children: React.ReactNode
  }) => (
    <a href={`${to}?board=${search?.board ?? ''}`} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-post-vote', () => ({
  usePostVote: ({ voteCount }: { voteCount: number }) => ({
    voteCount,
    hasVoted: false,
    isPending: false,
    handleVote,
  }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => vi.fn(),
}))
vi.mock('@/components/public/author-hover-card', () => ({
  AuthorHoverCard: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { PostCard } from '../post-card'
import { VoteButton } from '../vote-button'
import { ReadOnlyBoardNote } from '../feedback/read-only-board-note'

afterEach(() => {
  cleanup()
  handleVote.mockClear()
})

const wrap = (node: React.ReactNode) => render(<IntlProvider locale="en">{node}</IntlProvider>)
const NOTE = "This board isn't taking new feedback right now."
const PLAN_WORDS = /plan|upgrade|billing|limit|tier/i

describe('the read-only note', () => {
  it('says the board is not taking feedback and offers an open board', () => {
    wrap(<ReadOnlyBoardNote shareBoard={{ name: 'Feature requests', slug: 'features' }} />)
    const note = screen.getByTestId('read-only-board-note')
    expect(note).toHaveTextContent(`${NOTE} Share it in Feature requests.`)
    expect(screen.getByRole('link', { name: 'Feature requests' })).toHaveAttribute(
      'href',
      '/?board=features'
    )
    expect(note.textContent).not.toMatch(PLAN_WORDS)
  })

  it('leaves out the link when there is no open board to point at', () => {
    wrap(<ReadOnlyBoardNote shareBoard={null} />)
    expect(screen.getByTestId('read-only-board-note')).toHaveTextContent(NOTE)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('votes on a read-only board', () => {
  it('a post card shows the count, announces that voting is closed, and takes no click', () => {
    wrap(
      <PostCard
        id={'post_1' as PostId}
        title="Attachments fail"
        content="Safari"
        statusId={'post_status_open' as PostStatusId}
        statuses={[]}
        voteCount={12}
        commentCount={0}
        authorName="Kaye"
        createdAt={new Date('2026-10-01')}
        boardSlug="bugs"
        tags={[]}
        canVote={false}
        votingClosed
      />
    )
    const vote = screen.getByTestId('vote-button')
    expect(vote).toHaveAttribute('aria-label', '12 votes, voting closed')
    expect(vote).toBeDisabled()
    expect(screen.getByTestId('vote-count')).toHaveTextContent('12')
    fireEvent.click(vote)
    expect(handleVote).not.toHaveBeenCalled()
  })

  it('a post card on an open board still announces a vote to give', () => {
    wrap(
      <PostCard
        id={'post_1' as PostId}
        title="Attachments fail"
        content="Safari"
        statusId={'post_status_open' as PostStatusId}
        statuses={[]}
        voteCount={12}
        commentCount={0}
        authorName="Kaye"
        createdAt={new Date('2026-10-01')}
        boardSlug="bugs"
        tags={[]}
      />
    )
    expect(screen.getByTestId('vote-button').getAttribute('aria-label')).toMatch(/^Vote for/)
  })

  it('the detail vote button is a static count that announces voting is closed', () => {
    wrap(<VoteButton postId={'post_1' as PostId} voteCount={1} closed />)
    const vote = screen.getByTestId('vote-button')
    expect(vote.tagName).toBe('DIV')
    expect(vote).toHaveAttribute('aria-label', '1 vote, voting closed')
    fireEvent.click(vote)
    expect(handleVote).not.toHaveBeenCalled()
  })
})
