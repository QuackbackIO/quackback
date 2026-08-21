// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FilterList, StatusFilterList } from '../single-select-filter-list'

afterEach(cleanup)

describe('FilterList counts', () => {
  it('renders a count next to each item when counts are provided', () => {
    render(
      <FilterList
        items={[
          { id: 'responded', name: 'Responded' },
          { id: 'unresponded', name: 'Unresponded' },
        ]}
        selectedIds={[]}
        onSelect={() => {}}
        counts={{ responded: 4, unresponded: 12 }}
      />
    )

    expect(screen.getByRole('option', { name: 'Responded, 4' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Unresponded, 12' })).toBeInTheDocument()
  })

  it('hides counts while they are still loading', () => {
    render(
      <FilterList
        items={[{ id: 'deleted', name: 'Deleted posts' }]}
        selectedIds={[]}
        onSelect={() => {}}
      />
    )

    expect(screen.getByRole('option', { name: 'Deleted posts' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows 0 when a loaded counts map has no entry for the item', () => {
    render(
      <FilterList
        items={[{ id: 'deleted', name: 'Deleted posts' }]}
        selectedIds={[]}
        onSelect={() => {}}
        counts={{}}
      />
    )

    expect(screen.getByRole('option', { name: 'Deleted posts, 0' })).toBeInTheDocument()
  })

  it('forwards a click to onSelect', async () => {
    const onSelect = vi.fn()
    render(
      <FilterList
        items={[{ id: 'responded', name: 'Responded' }]}
        selectedIds={[]}
        onSelect={onSelect}
        counts={{ responded: 1 }}
      />
    )

    screen.getByRole('option', { name: 'Responded, 1' }).click()
    expect(onSelect).toHaveBeenCalledWith('responded', false)
  })
})

describe('StatusFilterList counts', () => {
  it('shows the status name and count', () => {
    render(
      <StatusFilterList
        statuses={[{ id: 's1', slug: 'open', name: 'Open', color: '#3b82f6' }]}
        selectedSlugs={[]}
        onSelect={() => {}}
        counts={{ open: 8 }}
      />
    )

    expect(screen.getByRole('option', { name: 'Open, 8' })).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })
})
