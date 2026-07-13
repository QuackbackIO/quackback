// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChangelogList } from '../changelog-list'

type ChangelogEntryFixture = {
  id: string
  title: string
  content: string
  status: 'draft' | 'scheduled' | 'published'
  publishedAt: string | null
  createdAt: string
  author: { name: string } | null
  category: { name: string; color?: string | null } | null
  product: { name: string } | null
  linkedPosts: Array<{ id: string; title: string; voteCount: number }>
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setFilters: vi.fn(),
  setSearchValue: vi.fn(),
  fetchNextPage: vi.fn(),
  deleteChangelog: vi.fn(),
  filters: {
    status: 'all',
    search: '',
  } as { status: string; search: string },
  hasActiveFilters: false,
  query: {
    data: null as null | { pages: Array<{ items: ChangelogEntryFixture[] }> },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: mocks.query.data,
    fetchNextPage: mocks.fetchNextPage,
    hasNextPage: mocks.query.hasNextPage,
    isFetchingNextPage: mocks.query.isFetchingNextPage,
    isLoading: mocks.query.isLoading,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/routes/admin/changelog', () => ({
  Route: {
    fullPath: '/admin/changelog',
    useSearch: () => ({ tab: 'all' }),
  },
}))

vi.mock('@/lib/client/queries/changelog', () => ({
  changelogQueries: {
    list: (params: { status: string }) => ({ queryKey: ['changelogs', params] }),
  },
}))

vi.mock('@/lib/client/mutations/changelog', () => ({
  useDeleteChangelog: () => ({
    isPending: false,
    mutate: mocks.deleteChangelog,
  }),
}))

vi.mock('../use-changelog-filters', () => ({
  useChangelogFilters: () => ({
    filters: mocks.filters,
    setFilters: mocks.setFilters,
    hasActiveFilters: mocks.hasActiveFilters,
  }),
}))

vi.mock('@/lib/client/hooks/use-debounced-search', () => ({
  useDebouncedSearch: ({
    externalValue,
  }: {
    externalValue: string
    onChange: (value: string) => void
  }) => ({
    value: externalValue,
    setValue: mocks.setSearchValue,
  }),
}))

vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: () => vi.fn(),
}))

vi.mock('@/components/admin/feedback/inbox-layout', () => ({
  InboxLayout: ({
    headerTitle,
    filters,
    children,
    hasActiveFilters,
  }: {
    headerIcon: unknown
    headerTitle: string
    filters: ReactNode
    children: ReactNode
    hasActiveFilters: boolean
  }) => (
    <main data-active={hasActiveFilters}>
      <h1>{headerTitle}</h1>
      {filters}
      {children}
    </main>
  ),
}))

vi.mock('@/components/admin/admin-list-header', () => ({
  AdminListHeader: ({
    searchValue,
    onSearchChange,
    action,
  }: {
    searchValue: string
    onSearchChange: (value: string) => void
    action?: ReactNode
  }) => (
    <header>
      <input
        data-search-input
        value={searchValue}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
      />
      {action}
    </header>
  ),
}))

vi.mock('../changelog-filters', () => ({
  ChangelogFiltersPanel: ({
    status,
    onStatusChange,
  }: {
    status: string
    onStatusChange: (status: string) => void
  }) => (
    <section>
      Status {status}
      <button type="button" onClick={() => onStatusChange('published')}>
        Published filter
      </button>
    </section>
  ),
}))

vi.mock('../create-changelog-dialog', () => ({
  CreateChangelogDialog: () => <button type="button">New Entry</button>,
}))

vi.mock('../changelog-list-item', () => ({
  ChangelogListItem: ({
    id,
    title,
    category,
    product,
    onEdit,
    onDelete,
  }: {
    id: string
    title: string
    category: { name: string } | null
    product: { name: string } | null
    onEdit?: (id: string) => void
    onDelete?: (id: string) => void
  }) => (
    <article>
      <h2>{title}</h2>
      <span>Category {category?.name ?? 'none'}</span>
      <span>Product {product?.name ?? 'none'}</span>
      <button type="button" onClick={() => onEdit?.(id)}>
        Edit {title}
      </button>
      <button type="button" onClick={() => onDelete?.(id)}>
        Delete {title}
      </button>
    </article>
  ),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    isPending?: boolean
    variant?: string
    onConfirm: () => void
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section role="alertdialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({
    title,
    action,
  }: {
    icon: unknown
    title: string
    className?: string
    action?: ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      {action}
    </section>
  ),
}))

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div>Skeleton row</div>,
}))

vi.mock('@/components/shared/spinner', () => ({
  Spinner: () => <span>Spinner</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  DocumentTextIcon: () => <span aria-hidden="true">doc</span>,
}))

function entry(overrides: Partial<ChangelogEntryFixture> = {}): ChangelogEntryFixture {
  return {
    id: 'changelog_1',
    title: 'Launch notes',
    content: 'Important launch body',
    status: 'published',
    publishedAt: '2026-06-20T09:00:00.000Z',
    createdAt: '2026-06-19T09:00:00.000Z',
    author: { name: 'Ada' },
    category: { name: 'Feature' },
    product: { name: 'Widget' },
    linkedPosts: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.filters = { status: 'all', search: '' }
  mocks.hasActiveFilters = false
  mocks.query = {
    data: { pages: [{ items: [entry()] }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }
  mocks.deleteChangelog.mockImplementation((_id, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
  })
})

describe('ChangelogList', () => {
  it('passes taxonomy props, filters, navigates edits, and confirms deletion', () => {
    render(<ChangelogList />)

    expect(screen.getByText('Changelog')).toBeInTheDocument()
    expect(screen.getByText('Category Feature')).toBeInTheDocument()
    expect(screen.getByText('Product Widget')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'roadmap' } })
    expect(mocks.setSearchValue).toHaveBeenCalledWith('roadmap')

    fireEvent.click(screen.getByRole('button', { name: 'Published filter' }))
    expect(mocks.setFilters).toHaveBeenCalledWith({ status: 'published' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit Launch notes' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/admin/changelog',
      search: { tab: 'all', entry: 'changelog_1' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch notes' }))
    expect(screen.getByRole('heading', { name: 'Delete changelog entry?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.deleteChangelog).toHaveBeenCalledWith(
      'changelog_1',
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('renders loading, empty search, empty filtered, empty initial, and pagination states', () => {
    mocks.query = { data: null, hasNextPage: false, isFetchingNextPage: false, isLoading: true }
    const { rerender } = render(<ChangelogList />)
    expect(screen.getAllByText('Skeleton row').length).toBeGreaterThan(0)

    mocks.query = {
      data: { pages: [{ items: [] }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    }
    mocks.filters = { status: 'all', search: 'missing' }
    rerender(<ChangelogList />)
    expect(
      screen.getByRole('heading', { name: 'No changelog entries match your search' })
    ).toBeInTheDocument()

    mocks.filters = { status: 'published', search: '' }
    mocks.hasActiveFilters = true
    rerender(<ChangelogList />)
    expect(
      screen.getByRole('heading', { name: 'No changelog entries match your filters' })
    ).toBeInTheDocument()

    mocks.filters = { status: 'all', search: '' }
    mocks.hasActiveFilters = false
    rerender(<ChangelogList />)
    expect(screen.getByRole('heading', { name: 'No changelog entries yet' })).toBeInTheDocument()

    mocks.query = {
      data: { pages: [{ items: [entry({ id: 'changelog_2', title: 'Roadmap update' })] }] },
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
    }
    rerender(<ChangelogList />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(mocks.fetchNextPage).toHaveBeenCalled()

    mocks.query = {
      data: { pages: [{ items: [entry({ id: 'changelog_3', title: 'Spinner update' })] }] },
      hasNextPage: true,
      isFetchingNextPage: true,
      isLoading: false,
    }
    rerender(<ChangelogList />)
    expect(screen.getByText('Spinner')).toBeInTheDocument()
  })
})
