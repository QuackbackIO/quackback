// @vitest-environment happy-dom
/**
 * The feedback rows are memoized on their props, and every row receives the
 * function that opens a post. It must stay the same function while the list's
 * URL and rows change, or each URL change renders every row again; and it must
 * still open the post with the list's current search and rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useOpenPost } from '../use-open-post'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const seen: Array<(postId: string) => void> = []
let setRows: (rows: { id: string }[]) => void = () => {}

/** Renders for each URL change, as the inbox does through its filters. */
function List() {
  useRouterState({ select: (s) => JSON.stringify(s.location.search) })
  const [rows, setRowsState] = useState([{ id: 'post_a' }, { id: 'post_b' }])
  setRows = setRowsState
  const openPost = useOpenPost(rows)
  seen.push(openPost)
  return (
    <button type="button" onClick={() => openPost('post_b')}>
      Open
    </button>
  )
}

function buildRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const feedbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/feedback',
    validateSearch: (search: Record<string, unknown>) => search as Record<string, string>,
    component: List,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([feedbackRoute]),
    history: createMemoryHistory({
      initialEntries: ['/admin/feedback?search=export&sort=votes'],
    }),
  })
}

describe('useOpenPost', () => {
  it('stays the same function while the URL and the rows change', async () => {
    seen.length = 0
    const router = buildRouter()
    render(<RouterProvider router={router} />)
    await screen.findByText('Open')

    await act(() => router.navigate({ to: '/admin/feedback', search: { search: 'exp' } as never }))
    act(() => setRows([{ id: 'post_c' }]))

    expect(router.state.location.search).toEqual({ search: 'exp' })
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(seen).size).toBe(1)
  })

  it('opens the post over the current search and saves the current rows', async () => {
    const router = buildRouter()
    render(<RouterProvider router={router} />)
    await screen.findByText('Open')
    act(() => setRows([{ id: 'post_b' }, { id: 'post_c' }]))
    // The memory history leaves the document's URL alone; the back link is
    // read from the document, as in the browser.
    window.history.replaceState(null, '', '/admin/feedback?search=export&sort=votes')

    await act(async () => {
      fireEvent.click(screen.getByText('Open'))
    })

    expect(router.state.location.search).toEqual({
      search: 'export',
      sort: 'votes',
      post: 'post_b',
    })
    expect(JSON.parse(sessionStorage.getItem('feedback-nav-context')!)).toEqual({
      postIds: ['post_b', 'post_c'],
      backUrl: '/admin/feedback?search=export&sort=votes',
    })
  })
})
