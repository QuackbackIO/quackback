// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelpCenterFiltersPanel } from '../help-center-filters'
import { HelpCenterFilterButton } from '../help-center-active-filters-bar'

vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: {
    categories: () => ({ queryKey: ['hc-categories'], queryFn: async () => [] }),
  },
}))

afterEach(cleanup)

describe('Help Center pane', () => {
  it('adds categories from a labelled button on the Categories header', async () => {
    const onNew = vi.fn()
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <HelpCenterFiltersPanel
          status="all"
          onStatusChange={() => {}}
          selectedCategoryId={undefined}
          onSelectCategory={() => {}}
          categoryActions={{ onNew, onEdit: vi.fn(), onDelete: vi.fn() }}
        />
      </QueryClientProvider>
    )
    expect(screen.queryByText('New category')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'New category' }))
    expect(onNew).toHaveBeenCalledWith(null)
  })
})

describe('HelpCenterFilterButton', () => {
  it('reads Filter and offers status and category', async () => {
    render(
      <HelpCenterFilterButton
        canAddStatus
        canAddCategory
        categories={[{ id: 'c1', name: 'Guides' }]}
        onSetStatus={vi.fn()}
        onSetCategory={vi.fn()}
      />
    )
    expect(screen.queryByText('Add filter')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Category' })).toBeInTheDocument()
  })

  it('is hidden when both filters are already set', () => {
    render(
      <HelpCenterFilterButton
        canAddStatus={false}
        canAddCategory={false}
        categories={[{ id: 'c1', name: 'Guides' }]}
        onSetStatus={vi.fn()}
        onSetCategory={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
  })

  it('stays when one filter can still be added', () => {
    render(
      <HelpCenterFilterButton
        canAddStatus
        canAddCategory={false}
        categories={[]}
        onSetStatus={vi.fn()}
        onSetCategory={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
  })
})
