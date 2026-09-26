// @vitest-environment happy-dom
/**
 * The feedback list stays on screen under a post opened from it, and opening
 * or closing one (a search-only navigation that adds or drops `post`) changes
 * none of its filters. The filters hook answers from the filters alone, so the
 * list, its header and its filter panel render only when a filter changes.
 * Setting a filter still keeps the rest of the URL, the open post included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

vi.mock('@/routes/admin/feedback', async () => {
  const { useSearch } = await import('@tanstack/react-router')
  return {
    Route: {
      useSearch: (opts?: object) => useSearch({ from: '/admin/feedback', ...opts } as never),
    },
  }
})

const { useInboxFilters } = await import('../use-inbox-filters')

let renders = 0
let latest: ReturnType<typeof useInboxFilters>

function Probe() {
  renders++
  latest = useInboxFilters()
  return <p>feedback page</p>
}

function buildRouter(search: Record<string, unknown>) {
  const root = createRootRoute({ component: () => <Outlet /> })
  const admin = createRoute({
    getParentRoute: () => root,
    path: '/admin',
    component: () => <Outlet />,
  })
  const feedback = createRoute({
    getParentRoute: () => admin,
    path: '/feedback',
    validateSearch: (raw: Record<string, unknown>) => raw,
    component: Probe,
  })
  const router = createRouter({
    routeTree: root.addChildren([admin.addChildren([feedback])]),
    history: createMemoryHistory({ initialEntries: ['/admin/feedback'] }),
  })
  return { router, search }
}

async function mount(search: Record<string, unknown>) {
  const { router } = buildRouter(search)
  render(<RouterProvider router={router} />)
  await screen.findByText('feedback page')
  await act(() => router.navigate({ to: '/admin/feedback', search } as never))
  return router
}

afterEach(() => {
  cleanup()
  renders = 0
})

describe('useInboxFilters', () => {
  it('renders nothing when a post opens or closes over the list', async () => {
    const router = await mount({ sort: 'votes', status: ['open'] })
    const settled = renders
    const filters = latest.filters

    await act(() =>
      router.navigate({
        to: '/admin/feedback',
        search: (prev: Record<string, unknown>) => ({ ...prev, post: 'post_1' }),
      } as never)
    )
    await act(() =>
      router.navigate({
        to: '/admin/feedback',
        search: (prev: Record<string, unknown>) => ({ ...prev, post: 'post_2' }),
      } as never)
    )

    expect(router.state.location.search).toMatchObject({ post: 'post_2' })
    expect(renders).toBe(settled)
    expect(latest.filters).toBe(filters)
    expect(latest.filters).toMatchObject({ sort: 'votes', status: ['open'] })
  })

  it('renders with the new filters when a filter changes, keeping the open post', async () => {
    const router = await mount({ sort: 'votes', post: 'post_1' })

    await act(async () => latest.setFilters({ status: ['open'] }))

    await waitFor(() => expect(latest.filters.status).toEqual(['open']))
    expect(router.state.location.search).toMatchObject({
      sort: 'votes',
      post: 'post_1',
      status: ['open'],
    })

    await act(async () => latest.toggleStatus('planned'))
    await waitFor(() => expect(latest.filters.status).toEqual(['open', 'planned']))
    expect(router.state.location.search).toMatchObject({ post: 'post_1' })
  })

  it('keeps only the sort when the filters are cleared', async () => {
    const router = await mount({ sort: 'votes', status: ['open'], board: ['board_1'] })

    await act(async () => latest.clearFilters())

    await waitFor(() => expect(latest.hasActiveFilters).toBe(false))
    expect(router.state.location.search).toEqual({ sort: 'votes' })
  })
})
