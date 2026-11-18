// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { PostId } from '@quackback/ids'

const handleVote = vi.hoisted(() => vi.fn())

vi.mock('@/lib/client/hooks/use-widget-vote', () => ({
  useWidgetVote: ({ voteCount }: { voteCount: number }) => ({
    voteCount,
    hasVoted: false,
    isPending: false,
    handleVote,
  }),
}))
vi.mock('../widget-auth-provider', () => ({ useWidgetAuth: () => ({ sessionVersion: 0 }) }))

import { WidgetVoteButton } from '../widget-vote-button'

afterEach(() => {
  cleanup()
  handleVote.mockClear()
})

describe('WidgetVoteButton on a read-only board', () => {
  it('shows the count, announces that voting is closed, and takes no vote', () => {
    render(
      <IntlProvider locale="en">
        <WidgetVoteButton postId={'post_1' as PostId} voteCount={12} closed />
      </IntlProvider>
    )
    const vote = screen.getByTestId('vote-button')
    expect(vote).toHaveAttribute('aria-label', '12 votes, voting closed')
    expect(vote).toBeDisabled()
    fireEvent.click(vote)
    expect(handleVote).not.toHaveBeenCalled()
  })

  it('on an open board still votes', () => {
    render(
      <IntlProvider locale="en">
        <WidgetVoteButton postId={'post_1' as PostId} voteCount={12} />
      </IntlProvider>
    )
    fireEvent.click(screen.getByTestId('vote-button'))
    expect(handleVote).toHaveBeenCalled()
  })
})
