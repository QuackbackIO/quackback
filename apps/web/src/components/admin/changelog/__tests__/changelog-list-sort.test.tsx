// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let search: { sort?: 'oldest'; status?: string } = {}
const listOptions = vi.fn((params: unknown) => ({ queryKey: ['changelog-list', params] }))
let pages: Array<{ items: Array<{ id: string; title: string; content: string }> }> = []

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: { pages },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({}),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))
vi.mock('@/routes/admin/changelog', () => ({
  Route: { fullPath: '/admin/changelog', useSearch: () => search },
}))
vi.mock('@/lib/client/queries/changelog', () => ({
  changelogQueries: { list: (params: unknown) => listOptions(params) },
}))
vi.mock('@/lib/client/mutations/changelog', () => ({
  useDeleteChangelog: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({ useInfiniteScroll: () => vi.fn() }))
vi.mock('@/components/admin/feedback/inbox-layout', () => ({
  InboxLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/admin/admin-list-header', () => ({ AdminListHeader: () => <div /> }))
vi.mock('../changelog-top-viewed', () => ({ ChangelogTopViewed: () => null }))
vi.mock('../changelog-list-item', () => ({
  ChangelogListItem: ({ title }: { title: string }) => <div data-testid="entry">{title}</div>,
}))

import { ChangelogList } from '../changelog-list'

afterEach(() => {
  cleanup()
  search = {}
  listOptions.mockClear()
})

const entry = (id: string, title: string) => ({ id, title, content: '' })

describe('ChangelogList order', () => {
  it('renders entries in the order the server returned them', () => {
    // Server order for "oldest": A was created first, C last.
    pages = [{ items: [entry('a', 'A'), entry('b', 'B')] }, { items: [entry('c', 'C')] }]
    search = { sort: 'oldest' }
    render(<ChangelogList />)
    expect(screen.getAllByTestId('entry').map((n) => n.textContent)).toEqual(['A', 'B', 'C'])
  })

  it('keeps the server order for newest', () => {
    pages = [{ items: [entry('c', 'C'), entry('b', 'B'), entry('a', 'A')] }]
    render(<ChangelogList />)
    expect(screen.getAllByTestId('entry').map((n) => n.textContent)).toEqual(['C', 'B', 'A'])
  })

  it('asks the server for the chosen sort', () => {
    pages = []
    search = { sort: 'oldest' }
    render(<ChangelogList />)
    expect(listOptions).toHaveBeenCalledWith({ status: 'all', sort: 'oldest' })
  })
})
