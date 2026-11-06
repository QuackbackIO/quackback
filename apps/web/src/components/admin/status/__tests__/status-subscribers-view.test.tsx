// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const removeMutateAsync = vi.hoisted(() => vi.fn())
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
  useRemoveStatusSubscriber: () => ({ mutateAsync: removeMutateAsync, isPending: false }),
}))
vi.mock('@/lib/server/functions/status', () => ({ exportStatusSubscribersAdminFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({ useInfiniteScroll: () => vi.fn() }))

const { StatusSubscribersView } = await import('../status-subscribers-view')

afterEach(() => {
  cleanup()
  removeMutateAsync.mockReset()
})

function sub(over: Record<string, unknown>) {
  return {
    id: 's1',
    principalId: 'principal_ada',
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

  it('offers Remove only on active subscribers', () => {
    items = [
      sub({ id: 's1', principalId: 'principal_ada' }),
      sub({
        id: 's2',
        principalId: 'principal_bo',
        displayName: 'Bo',
        unsubscribedAt: new Date().toISOString(),
      }),
    ]
    render(<StatusSubscribersView />)
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Bo' })).toBeNull()
  })

  it('removes the chosen subscriber after confirmation', async () => {
    removeMutateAsync.mockResolvedValue({ success: true, removed: true })
    items = [sub({ id: 's1', principalId: 'principal_ada' })]
    render(<StatusSubscribersView />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledWith('principal_ada'))
  })

  it('leaves the subscriber in place when the removal is cancelled', async () => {
    items = [sub({ id: 's1', principalId: 'principal_ada' })]
    render(<StatusSubscribersView />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(removeMutateAsync).not.toHaveBeenCalled()
  })
})
