// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublicFiltersBar, PublicMoreFilters } from '../public-filters-bar'
import { PortalPermissionsProvider } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'

const statuses: PostStatusEntity[] = [
  {
    id: 'post_status_1' as PostStatusEntity['id'],
    slug: 'open',
    name: 'Open',
    color: '#3b82f6',
    category: 'active',
  } as PostStatusEntity,
  {
    id: 'post_status_2' as PostStatusEntity['id'],
    slug: 'complete',
    name: 'Complete',
    color: '#10b981',
    category: 'complete',
  } as PostStatusEntity,
]

const tags: PostTag[] = [
  { id: 'tag_1', name: 'Backend', color: '#8b5cf6' } as unknown as PostTag,
  { id: 'tag_2', name: 'Frontend', color: '#ec4899' } as unknown as PostTag,
]

const boards = [
  { id: 'board_1', slug: 'feature-requests', name: 'Feature Requests' },
  { id: 'board_2', slug: 'bugs', name: 'Bugs' },
]

/** The bar reaches for useTeamMembers (react-query) via the owner filter, so
 *  every render needs a QueryClient alongside intl. */
function Providers({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" defaultLocale="en">
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

function renderBar(overrides: Partial<React.ComponentProps<typeof PublicFiltersBar>> = {}) {
  const setFilters = vi.fn()
  const clearFilters = vi.fn()
  const result = render(
    <Providers>
      <PublicFiltersBar
        filters={{ sort: 'top' }}
        setFilters={setFilters}
        clearFilters={clearFilters}
        statuses={statuses}
        tags={tags}
        boards={boards}
        {...overrides}
      />
    </Providers>
  )
  return { setFilters, clearFilters, ...result }
}

describe('PublicFiltersBar', () => {
  it('shows no chips, and no bar, at the default scope', () => {
    renderBar()
    expect(screen.queryByRole('region', { name: 'Active filters' })).not.toBeInTheDocument()
    cleanup()
    renderBar({ filters: { sort: 'top', search: 'widget' } })
    expect(screen.queryByText(/^Status:$/)).not.toBeInTheDocument()
  })

  it('shows the view as a chip that can be removed', () => {
    const { setFilters } = renderBar({ filters: { sort: 'top', view: 'voted' } })
    expect(screen.getByText(/^Show:$/)).toBeInTheDocument()
    expect(screen.getByText('Voted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove show/i }))
    expect(setFilters).toHaveBeenCalledWith({ view: undefined })
  })

  it('shows a status the URL names but the workspace no longer has, so it can be removed', () => {
    const { setFilters } = renderBar({ filters: { sort: 'top', status: ['retired'] } })
    expect(screen.getByText('retired')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove status/i }))
    expect(setFilters).toHaveBeenCalledWith({ status: undefined })
  })

  it('sums the picked statuses up in one chip that resets to the default', () => {
    const { setFilters } = renderBar({ filters: { sort: 'top', status: ['open', 'retired'] } })
    expect(screen.getAllByText(/^Status:$/)).toHaveLength(1)
    expect(screen.getByText('Open and retired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add filter/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove status/i }))
    expect(setFilters).toHaveBeenCalledWith({ status: undefined })
    cleanup()
    renderBar({ filters: { sort: 'top', status: ['open', 'complete'] } })
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('renders a board chip when filters.board is set', () => {
    renderBar({ filters: { sort: 'top', board: 'bugs' } })
    expect(screen.getByText(/^Board:$/)).toBeInTheDocument()
    expect(screen.getByText('Bugs')).toBeInTheDocument()
  })

  it('does not render a board chip when only one board exists', () => {
    renderBar({
      filters: { sort: 'top', board: 'bugs' },
      boards: [{ id: 'board_2', slug: 'bugs', name: 'Bugs' }],
    })
    expect(screen.queryByText(/^Board:$/)).not.toBeInTheDocument()
  })

  it('edits the statuses from the chip with the same pills as the panel', () => {
    const { setFilters } = renderBar({ filters: { sort: 'top', status: ['open'] } })
    fireEvent.click(screen.getByRole('button', { name: /^Status:/ }))
    const open = screen.getByRole('button', { name: 'Open', pressed: true })
    fireEvent.click(screen.getByRole('button', { name: 'Complete', pressed: false }))
    expect(setFilters).toHaveBeenLastCalledWith({ status: ['open', 'complete'] })
    fireEvent.click(open)
    expect(setFilters).toHaveBeenLastCalledWith({ status: undefined })
  })

  it('sums the picked tags up in one chip whose pills add and remove tags', () => {
    const { setFilters } = renderBar({ filters: { sort: 'top', tagIds: ['tag_1'] } })
    expect(screen.getByText(/^Tag:$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Tag:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Frontend', pressed: false }))
    expect(setFilters).toHaveBeenLastCalledWith({ tagIds: ['tag_1', 'tag_2'] })
    fireEvent.click(screen.getByRole('button', { name: 'Backend', pressed: true }))
    expect(setFilters).toHaveBeenLastCalledWith({ tagIds: undefined })
    cleanup()
    renderBar({ filters: { sort: 'top', tagIds: ['tag_1', 'tag_2'] } })
    expect(screen.getAllByText(/^Tags:$/)).toHaveLength(1)
    expect(screen.getByText('Backend and Frontend')).toBeInTheDocument()
  })

  it('switches a one-pick filter from its chip, and clears it from the lit pill', () => {
    const { setFilters } = renderBar({ filters: { sort: 'top', board: 'bugs' } })
    fireEvent.click(screen.getByRole('button', { name: /^Board:/ }))
    expect(screen.getByRole('dialog', { name: 'Board' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Feature Requests', pressed: false }))
    expect(setFilters).toHaveBeenLastCalledWith({ board: 'feature-requests' })
    fireEvent.click(screen.getByRole('button', { name: 'Bugs', pressed: true }))
    expect(setFilters).toHaveBeenLastCalledWith({ board: undefined })
  })

  it('renders combined Tags chip when 3+ tags selected', () => {
    const tagsMany: PostTag[] = [
      ...tags,
      { id: 'tag_3', name: 'API', color: '#f59e0b' } as unknown as PostTag,
      { id: 'tag_4', name: 'Mobile', color: '#06b6d4' } as unknown as PostTag,
    ]
    renderBar({
      filters: { sort: 'top', tagIds: ['tag_1', 'tag_2', 'tag_3', 'tag_4'] },
      tags: tagsMany,
    })
    expect(screen.getByText(/Backend, Frontend \+2/)).toBeInTheDocument()
  })

  it('shows Clear all when 2+ chips active', () => {
    renderBar({ filters: { sort: 'top', minVotes: 10, dateFrom: '2026-04-01' } })
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument()
  })

  it('does not show Clear all with only 1 chip', () => {
    renderBar({ filters: { sort: 'top', minVotes: 10 } })
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('Clear all calls clearFilters', () => {
    const { clearFilters } = renderBar({
      filters: { sort: 'top', minVotes: 10, dateFrom: '2026-04-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(clearFilters).toHaveBeenCalled()
  })
})

describe('PublicMoreFilters', () => {
  function renderMore(
    filters: React.ComponentProps<typeof PublicMoreFilters>['filters'] = { sort: 'top' },
    team?: {
      members: { id: string; name: string }[]
      segments: { id: string; name: string; color: string }[]
    }
  ) {
    const setFilters = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    if (team) {
      client.setQueryData(['admin', 'team-members'], team.members)
      client.setQueryData(['admin', 'segments'], team.segments)
    }
    render(
      <QueryClientProvider client={client}>
        <PortalPermissionsProvider permissionKeys={team ? [PERMISSIONS.POST_VIEW_PRIVATE] : []}>
          <IntlProvider locale="en" defaultLocale="en">
            <PublicMoreFilters filters={filters} setFilters={setFilters} />
          </IntlProvider>
        </PortalPermissionsProvider>
      </QueryClientProvider>
    )
    return { setFilters }
  }

  const toggle = () => screen.getByRole('button', { name: /more filters/i })

  it('starts folded and unfolds the less common filters as pills', () => {
    renderMore()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Vote count' })).not.toBeInTheDocument()
    fireEvent.click(toggle())
    for (const name of ['Team response', 'Posted in the last', 'Vote count']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
  })

  it('starts unfolded when one of its filters is on, with a count', () => {
    renderMore({ sort: 'top', minVotes: 50 })
    expect(screen.getByRole('button', { name: /more filters\s*1/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('button', { name: '50+' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('lights no pill for a value the panel does not offer, but still counts it', () => {
    renderMore({ sort: 'top', minVotes: 25 })
    expect(screen.getByRole('button', { name: /more filters\s*1/i })).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('picks one value per group, and clears it when the lit pill is clicked again', () => {
    const { setFilters } = renderMore({ sort: 'top', responded: 'responded' })
    fireEvent.click(screen.getByRole('button', { name: 'Awaiting reply' }))
    expect(setFilters).toHaveBeenCalledWith({ responded: 'unresponded' })
    fireEvent.click(screen.getByRole('button', { name: 'Replied' }))
    expect(setFilters).toHaveBeenCalledWith({ responded: undefined })
  })

  it('sets a date preset as a calendar date', () => {
    const { setFilters } = renderMore()
    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    expect(setFilters).toHaveBeenCalledWith({
      dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('has no owner or segment filters for customers', () => {
    renderMore()
    fireEvent.click(toggle())
    expect(screen.queryByRole('group', { name: 'Owner' })).not.toBeInTheDocument()
    expect(screen.queryByText('Only your team sees this')).not.toBeInTheDocument()
  })

  it('gives the team owner and segment filters, marked as internal', () => {
    const { setFilters } = renderMore(
      { sort: 'top' },
      {
        members: [{ id: 'm1', name: 'Sam' }],
        segments: [{ id: 'seg1', name: 'Enterprise', color: '#f59e0b' }],
      }
    )
    fireEvent.click(toggle())
    expect(screen.getByText('Only your team sees this')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
    expect(setFilters).toHaveBeenCalledWith({ owner: 'unassigned' })
    fireEvent.click(screen.getByRole('button', { name: 'Enterprise' }))
    expect(setFilters).toHaveBeenCalledWith({ segmentIds: ['seg1'] })
  })
})
