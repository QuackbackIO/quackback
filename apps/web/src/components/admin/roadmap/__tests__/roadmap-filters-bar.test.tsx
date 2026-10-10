// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoadmapFiltersBar } from '../roadmap-filters-bar'

afterEach(cleanup)

function renderBar(onFiltersChange = vi.fn(), filters = {}) {
  render(
    <RoadmapFiltersBar
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearAll={vi.fn()}
      boards={[{ id: 'board_1', name: 'Bugs' }]}
      tags={[]}
      onToggleBoard={vi.fn()}
      onToggleTag={vi.fn()}
    />
  )
  return onFiltersChange
}

describe('RoadmapFiltersBar', () => {
  it('shows a search field, a sort menu and a Filter control on one row', () => {
    renderBar()
    const search = screen.getByPlaceholderText('Search posts...')
    const row = search.closest('[data-slot="admin-list-search"]')!.parentElement!
    const labels = Array.from(row.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toContain('Sort: Votes')
    expect(labels).toContain('Filter')
    expect(screen.queryByText('Add filter')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('changes the sort from the menu', async () => {
    const onFiltersChange = renderBar()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sort: Votes' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Oldest' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ sort: 'oldest' })
  })

  it('sends typed search to the filters', async () => {
    vi.useFakeTimers()
    const onFiltersChange = renderBar()
    fireEvent.change(screen.getByPlaceholderText('Search posts...'), { target: { value: 'dark' } })
    vi.advanceTimersByTime(400)
    vi.useRealTimers()
    expect(onFiltersChange).toHaveBeenCalledWith({ search: 'dark' })
  })
})
