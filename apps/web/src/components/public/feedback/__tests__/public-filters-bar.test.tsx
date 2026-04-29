// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import {
  PublicFiltersBar,
  PublicFiltersAddButton,
  PublicFiltersToolbarButton,
} from '../public-filters-bar'
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

const boards = [
  { id: 'board_1', slug: 'feature-requests', name: 'Feature Requests' },
  { id: 'board_2', slug: 'bugs', name: 'Bugs' },
]

function renderBar(overrides: Partial<React.ComponentProps<typeof PublicFiltersBar>> = {}) {
  const setFilters = vi.fn()
  const clearFilters = vi.fn()
  const result = render(
    <IntlProvider locale="en" defaultLocale="en">
      <PublicFiltersBar
        filters={{ sort: 'top' }}
        setFilters={setFilters}
        clearFilters={clearFilters}
        statuses={statuses}
        tags={tags}
        boards={boards}
        {...overrides}
      />
    </IntlProvider>
  )
  return { setFilters, clearFilters, ...result }
}

describe('PublicFiltersBar', () => {
  it('renders nothing when no filters are active (toolbar carries the entry point)', () => {
    const { container } = renderBar()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders chips + the dashed Add filter pill when chips are active', () => {
    renderBar({ filters: { sort: 'top', status: ['open'] } })
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText(/^Status:$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument()
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

  it('Clear all calls clearFilters', () => {
    const { clearFilters } = renderBar({
      filters: { sort: 'top', minVotes: 10, dateFrom: '2026-04-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(clearFilters).toHaveBeenCalled()
  })
})

describe('PublicFiltersToolbarButton', () => {
  it('renders the solid Filter button (toolbar variant)', () => {
    const setFilters = vi.fn()
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <PublicFiltersToolbarButton
          filters={{ sort: 'top' }}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
          boards={boards}
        />
      </IntlProvider>
    )
    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument()
  })

  it('opens the same category menu and lets users add a vote-count filter', () => {
    const setFilters = vi.fn()
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <PublicFiltersToolbarButton
          filters={{ sort: 'top' }}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
          boards={boards}
        />
      </IntlProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /filter/i }))
    fireEvent.click(screen.getByRole('button', { name: /vote count/i }))
    // cmdk's CommandItem renders with role="option"
    fireEvent.click(screen.getByRole('option', { name: /25\+ votes/i }))
    expect(setFilters).toHaveBeenCalledWith({ minVotes: 25 })
  })

  it('lets users pick a board from the filter menu', () => {
    const setFilters = vi.fn()
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <PublicFiltersToolbarButton
          filters={{ sort: 'top' }}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
          boards={boards}
        />
      </IntlProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /filter/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Board$/i }))
    // cmdk's CommandItem renders with role="option"
    fireEvent.click(screen.getByRole('option', { name: 'Bugs' }))
    expect(setFilters).toHaveBeenCalledWith({ board: 'bugs' })
  })

  it('hides the Board category when only a single board exists', () => {
    const setFilters = vi.fn()
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <PublicFiltersToolbarButton
          filters={{ sort: 'top' }}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
          boards={[{ id: 'board_1', slug: 'feature-requests', name: 'Feature Requests' }]}
        />
      </IntlProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /filter/i }))
    expect(screen.queryByRole('button', { name: /^Board$/i })).not.toBeInTheDocument()
  })
})

describe('PublicFiltersAddButton (pill variant)', () => {
  it('clicking a status in the submenu adds it via setFilters', () => {
    const setFilters = vi.fn()
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <PublicFiltersAddButton
          filters={{ sort: 'top' }}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
          boards={boards}
        />
      </IntlProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /^add filter$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Status$/i }))
    // cmdk's CommandItem renders with role="option"
    fireEvent.click(screen.getByRole('option', { name: 'Open' }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open'] })
  })
})
