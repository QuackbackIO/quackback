// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let items: unknown[] = []
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useInfiniteQuery: () => ({
    data: { pages: [{ items }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }),
}))
vi.mock('@/lib/client/queries/status', () => ({
  statusSubscriberQueries: { counts: () => ({}), list: () => ({}) },
}))
vi.mock('@/lib/client/mutations/status', () => ({
  useAddStatusSubscriber: () => ({ mutate: vi.fn(), isPending: false }),
  useImportStatusSubscribers: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/server/functions/status', () => ({ exportStatusSubscribersAdminFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({ useInfiniteScroll: () => vi.fn() }))

const { StatusSubscribersView } = await import('../status-subscribers-view')

afterEach(cleanup)

function sub(over: Record<string, unknown>) {
  return {
    id: 's1',
    displayName: 'Ada',
    email: 'ada@example.com',
    scope: 'page',
    componentIds: [],
    source: 'self_serve',
    createdAt: new Date().toISOString(),
    unsubscribedAt: null,
    ...over,
  }
}

describe('StatusSubscribersView', () => {
  it('labels the create action New subscriber', () => {
    items = []
    render(<StatusSubscribersView />)
    expect(screen.getByRole('button', { name: 'New subscriber' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add subscribers' })).toBeNull()
  })

  it('shows no badges for a whole-page self-serve subscriber', () => {
    items = [sub({})]
    const { container } = render(<StatusSubscribersView />)
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="badge"]')).toHaveLength(0)
  })

  it('badges only non-default scope and source, in sentence case', () => {
    items = [sub({ scope: 'components', componentIds: ['a', 'b'], source: 'csv_import' })]
    render(<StatusSubscribersView />)
    expect(screen.getByText('2 services')).toBeInTheDocument()
    expect(screen.getByText('CSV import')).toBeInTheDocument()
    expect(screen.queryByText('Whole page')).toBeNull()
  })
})
