// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PublicFiltersBar } from '../public-filters-bar'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'

const statuses: PostStatusEntity[] = [
  {
    id: 'status_1' as PostStatusEntity['id'],
    slug: 'open',
    name: 'Open',
    color: '#3b82f6',
    category: 'active',
  } as PostStatusEntity,
  {
    id: 'status_2' as PostStatusEntity['id'],
    slug: 'complete',
    name: 'Complete',
    color: '#10b981',
    category: 'complete',
  } as PostStatusEntity,
]

const tags: Tag[] = [
  { id: 'tag_1', name: 'Backend', color: '#8b5cf6' } as unknown as Tag,
  { id: 'tag_2', name: 'Frontend', color: '#ec4899' } as unknown as Tag,
]

function renderBar(overrides: Partial<React.ComponentProps<typeof PublicFiltersBar>> = {}) {
  const setFilters = vi.fn()
  const clearFilters = vi.fn()
  render(
    <IntlProvider locale="en" defaultLocale="en">
      <PublicFiltersBar
        filters={{ sort: 'top' }}
        setFilters={setFilters}
        clearFilters={clearFilters}
        statuses={statuses}
        tags={tags}
        {...overrides}
      />
    </IntlProvider>
  )
  return { setFilters, clearFilters }
}

describe('PublicFiltersBar', () => {
  it('renders the Add filter button when no filters are active', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument()
  })

  it('shows the "Hiding completed and closed" hint when no status filter is set', () => {
    renderBar()
    expect(screen.getByText(/hiding completed and closed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument()
  })

  it('hides the hint once a status is selected', () => {
    renderBar({ filters: { sort: 'top', status: ['open'] } })
    expect(screen.queryByText(/hiding completed and closed/i)).not.toBeInTheDocument()
  })

  it('Show all sets status to all known status slugs', () => {
    const { setFilters } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /show all/i }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open', 'complete'] })
  })

  it('renders a status chip per active status with correct label', () => {
    renderBar({ filters: { sort: 'top', status: ['open'] } })
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText(/^Status:$/)).toBeInTheDocument()
  })

  it('renders combined Tags chip when 3+ tags selected', () => {
    const tagsMany: Tag[] = [
      ...tags,
      { id: 'tag_3', name: 'API', color: '#f59e0b' } as unknown as Tag,
      { id: 'tag_4', name: 'Mobile', color: '#06b6d4' } as unknown as Tag,
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

  it('clicking a vote-count preset calls setFilters with minVotes', () => {
    const { setFilters } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }))
    fireEvent.click(screen.getByRole('button', { name: /vote count/i }))
    fireEvent.click(screen.getByRole('button', { name: /25\+ votes/i }))
    expect(setFilters).toHaveBeenCalledWith({ minVotes: 25 })
  })

  it('clicking a status in the submenu adds it via setFilters', () => {
    const { setFilters } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /^add filter$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Status$/i }))
    // 'Open' status is rendered as a button with the status name as text content.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open'] })
  })

  it('Clear all calls clearFilters', () => {
    const { clearFilters } = renderBar({
      filters: { sort: 'top', minVotes: 10, dateFrom: '2026-04-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(clearFilters).toHaveBeenCalled()
  })
})
