// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ChangelogId, PostId, PostStatusId } from '@quackback/ids'
import type { PostStatusEntity } from '@/lib/shared/db-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to
    )
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))
vi.mock('@/lib/client/hooks/use-post-vote', () => ({
  usePostVote: ({ voteCount }: { voteCount: number }) => ({
    voteCount,
    hasVoted: false,
    isPending: false,
    handleVote: vi.fn(),
  }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => vi.fn(),
}))
vi.mock('@/components/public/author-hover-card', () => ({
  AuthorHoverCard: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { PostCard } from '../post-card'

afterEach(cleanup)

const statuses: PostStatusEntity[] = [
  { id: 'post_status_open', slug: 'open', name: 'Open', color: '#3b82f6', category: 'active' },
  {
    id: 'post_status_done',
    slug: 'complete',
    name: 'Complete',
    color: '#22c55e',
    category: 'complete',
  },
] as unknown as PostStatusEntity[]

function renderCard(props: Partial<React.ComponentProps<typeof PostCard>> = {}) {
  return render(
    <IntlProvider locale="en">
      <PostCard
        id={'post_1' as PostId}
        title="Dark mode"
        content="Please"
        statusId={'post_status_open' as PostStatusId}
        statuses={statuses}
        voteCount={3}
        commentCount={0}
        authorName="Kaye"
        createdAt={new Date('2026-10-01')}
        boardSlug="ideas"
        tags={[{ id: 'tag_ui', name: 'UI', color: '#38bdf8' }]}
        {...props}
      />
    </IntlProvider>
  )
}

describe('PostCard in the portal', () => {
  it('links the title to the post, and nothing else is a link to it', () => {
    renderCard()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('Dark mode')
    expect(links[0]).toHaveAttribute('href', '/b/ideas/posts/post_1')
  })

  it('keeps the vote button outside the link', () => {
    renderCard()
    expect(screen.getByRole('link').contains(screen.getByTestId('vote-button'))).toBe(false)
  })

  it('makes tags buttons that filter by the tag', () => {
    const onTagClick = vi.fn()
    renderCard({ onTagClick })
    fireEvent.click(screen.getByRole('button', { name: 'UI' }))
    expect(onTagClick).toHaveBeenCalledWith('tag_ui')
  })

  it('shows tags as plain labels without a handler', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'UI' })).not.toBeInTheDocument()
    expect(screen.getByText('UI')).toBeInTheDocument()
  })

  it('links a shipped post to its changelog entry', () => {
    renderCard({
      statusId: 'post_status_done' as PostStatusId,
      changelogEntry: { id: 'changelog_1' as ChangelogId, title: 'October release' },
    })
    expect(screen.getByRole('link', { name: 'In the changelog' })).toHaveAttribute(
      'href',
      '/changelog/changelog_1'
    )
  })

  it('marks complete and closed posts as done', () => {
    const { container } = renderCard({ statusId: 'post_status_done' as PostStatusId })
    expect(container.querySelector('[data-post-id]')).toHaveAttribute('data-done', 'true')
  })

  it('does not mark active posts as done', () => {
    const { container } = renderCard()
    expect(container.querySelector('[data-post-id]')).not.toHaveAttribute('data-done')
  })
})
