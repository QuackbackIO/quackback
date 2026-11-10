// @vitest-environment happy-dom
/**
 * A post's details on the portal: the design picks which details show (the
 * status always does), whether the vote control sits here or only a count
 * over the team's voters list, and marks the parts the builder picks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PostId } from '@quackback/ids'

vi.mock('@/components/public/auth-vote-button', () => ({
  AuthVoteButton: () => <button type="button">Vote</button>,
}))
vi.mock('@/components/public/auth-subscription-bell', () => ({
  AuthSubscriptionBell: () => <button type="button">Bell</button>,
}))
vi.mock('@/components/admin/feedback/voters-avatar-stack', () => ({
  VotersAvatarStack: () => <div data-testid="voters" />,
}))
vi.mock('@/components/public/author-hover-card', () => ({
  AuthorHoverCard: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/admin/admin-author-hover-card', () => ({
  AdminAuthorHoverCard: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/lib/server/functions/portal-detail', () => ({}))

const { MetadataSidebar } = await import('../metadata-sidebar')

afterEach(cleanup)

function show(props: Partial<React.ComponentProps<typeof MetadataSidebar>> = {}) {
  const client = new QueryClient()
  client.setQueryData(['vote-sidebar', 'post_1'], { isMember: false, canVote: true })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" onError={() => {}}>
        <MetadataSidebar
          postId={'post_1' as PostId}
          voteCount={333}
          status={{ id: 'status_1', name: 'Planned', color: '#7c3aed' }}
          board={{ id: 'board_1', name: 'Feature Requests', slug: 'features' }}
          authorName="Casey"
          createdAt={new Date('2026-01-01T00:00:00Z')}
          tags={[{ id: 'tag_1', name: 'Bug', color: '#f00' }]}
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('the post’s details', () => {
  it('shows every detail and the vote control by default, as it always has', () => {
    show()
    for (const name of ['Board', 'Tags', 'Date', 'Author', 'Status'])
      expect(screen.getByText(name)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vote' })).toBeTruthy()
  })

  it('leaves out the details the design turns off, never the status', () => {
    show({ rows: { board: false, tags: false, date: false, author: false } })
    for (const name of ['Board', 'Tags', 'Date', 'Author'])
      expect(screen.queryByText(name)).toBeNull()
    expect(screen.getByText('Status')).toBeTruthy()
  })

  it('draws no vote control where the post has it beside its title', () => {
    show({ portalVote: 'none' })
    expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull()
    expect(screen.queryByText('Upvotes')).toBeNull()
  })

  it('keeps only the count over the team’s voters list, not a second control', () => {
    show({ portalVote: 'count', showVoters: true })
    expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull()
    expect(screen.getByText('333')).toBeTruthy()
    expect(screen.getByTestId('voters')).toBeTruthy()
  })

  it('marks the details and its vote control as the builder’s parts', () => {
    const { container } = show({ markParts: true })
    expect(container.querySelector('aside')!.getAttribute('data-qb-section')).toBe('details')
    const vote = screen.getByRole('button', { name: 'Vote' })
    expect(vote.closest('[data-qb-section]')!.getAttribute('data-qb-section')).toBe('vote')
  })

  it('leaves Subscribe out where the design moves it', () => {
    show({ hideSubscribe: true })
    expect(screen.queryByRole('button', { name: 'Bell' })).toBeNull()
  })
})
