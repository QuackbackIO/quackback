// @vitest-environment happy-dom
/**
 * The list column owns search and the list toolbar: a labelled create button,
 * a search box at every width, a Sort menu and a Filter menu that wrap instead
 * of clipping, and a removable chip for each active filter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ComponentProps } from 'react'

afterEach(cleanup)

vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: ({ open }: { open: boolean }) =>
    open ? <div>new-conversation-dialog</div> : null,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ userRole: 'admin', settings: { featureFlags: {} } }),
}))
vi.mock('@/lib/client/hooks/use-activation-action', () => ({
  useActivationAction: () => null,
}))

const { ConversationListColumn } = await import('../conversation-list-column')

const noop = () => {}
const PROPS: ComponentProps<typeof ConversationListColumn> = {
  nav: { kind: 'view', view: 'all' },
  onSelectNav: noop,
  scopeLabel: 'All conversations',
  showRefinements: true,
  searchInput: '',
  onSearchInput: noop,
  facet: 'open',
  onFacet: noop,
  priorityFilter: 'all',
  onPriorityFilter: noop,
  onChannelFilter: noop,
  sort: 'recent',
  onSort: noop,
  loading: false,
  items: [],
  selectedId: null,
  onSelect: noop,
}

function renderColumn(props: Partial<ComponentProps<typeof ConversationListColumn>> = {}) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <ConversationListColumn {...PROPS} {...props} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('ConversationListColumn toolbar', () => {
  it('has a labelled New conversation button that opens the compose dialog', () => {
    renderColumn()
    fireEvent.click(screen.getByText('New conversation'))
    expect(screen.getByText('new-conversation-dialog')).toBeTruthy()
  })

  it('searches from the list column at every width', () => {
    const onSearchInput = vi.fn()
    renderColumn({ onSearchInput })
    const box = screen.getByPlaceholderText('Search conversations...')
    expect(box.closest('.lg\\:hidden')).toBeNull()
    fireEvent.change(box, { target: { value: 'refund' } })
    expect(onSearchInput).toHaveBeenCalledWith('refund')
  })

  it('names the list search for assistive technology', () => {
    renderColumn()
    expect(screen.getByRole('textbox', { name: 'Search the inbox' })).toBeTruthy()
  })

  it('shows Sort and Filter menus and wraps rather than scrolling sideways', () => {
    renderColumn()
    const sort = screen.getByRole('button', { name: /Sort: Most recent/ })
    expect(screen.getByRole('button', { name: /Filter/ })).toBeTruthy()
    expect(sort.parentElement?.className).toContain('flex-wrap')
    expect(sort.parentElement?.className).not.toContain('overflow-x-auto')
  })

  it('shows a removable chip per active filter', () => {
    const onPriorityFilter = vi.fn()
    const onCompany = vi.fn()
    renderColumn({
      priorityFilter: 'high',
      onPriorityFilter,
      companyFilter: {
        companies: [{ id: 'company_1', name: 'Acme' }],
        value: 'company_1',
        onChange: onCompany,
      },
    })
    expect(screen.getByText('Acme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove Priority High filter/ }))
    expect(onPriorityFilter).toHaveBeenCalledWith('all')
    fireEvent.click(screen.getByRole('button', { name: /Remove Company Acme filter/ }))
    expect(onCompany).toHaveBeenCalledWith(undefined)
  })

  it('keeps an active company filter visible and clearable where refinements are hidden', () => {
    const onCompany = vi.fn()
    renderColumn({
      showRefinements: false,
      companyFilter: {
        companies: [{ id: 'company_1', name: 'Acme' }],
        value: 'company_1',
        onChange: onCompany,
      },
    })
    expect(screen.getByText('Acme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove Company Acme filter/ }))
    expect(onCompany).toHaveBeenCalledWith(undefined)
  })

  it('shows no company chip when no company is selected', () => {
    renderColumn({
      showRefinements: false,
      companyFilter: {
        companies: [{ id: 'company_1', name: 'Acme' }],
        value: undefined,
        onChange: noop,
      },
    })
    expect(screen.queryByText('Acme')).toBeNull()
  })

  it('counts active filters on the Filter button', () => {
    renderColumn({ priorityFilter: 'high' })
    expect(screen.getByRole('button', { name: /Filter/ }).textContent).toContain('1')
  })
})
