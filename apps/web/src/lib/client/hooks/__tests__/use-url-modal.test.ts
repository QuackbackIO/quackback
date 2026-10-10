// @vitest-environment happy-dom
/**
 * A URL modal closes and moves between items by rewriting its one search
 * param on whatever page it is open over, keeping the page's other params,
 * and its callbacks stay the same functions while the location changes.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from '@tanstack/react-router'
import { useUrlModal } from '../use-url-modal'

const ENTRY = 'changelog_01h455vb4pex5vsknk084sn02q'
const OTHER = 'changelog_01h455vb4pex5vsknk084sn02r'

afterEach(cleanup)

const seen: Array<ReturnType<typeof useUrlModal>> = []

function Probe() {
  const { entry } = useSearch({ strict: false }) as { entry?: string }
  seen.push(useUrlModal({ urlId: entry, idPrefix: 'changelog', searchParam: 'entry' }))
  return createElement('p', null, 'changelog page')
}

async function mount(initial: string) {
  const rootRoute = createRootRoute({ component: () => createElement(Outlet) })
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/changelog',
    validateSearch: (search: Record<string, unknown>) =>
      search as { entry?: string; status?: string },
    component: Probe,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  render(createElement(RouterProvider, { router: router as never }))
  await screen.findByText('changelog page')
  return router
}

describe('useUrlModal', () => {
  it('drops only its own param on close and keeps the page and its other params', async () => {
    const router = await mount(`/admin/changelog?status=draft&entry=${ENTRY}`)
    expect(seen.at(-1)!.validatedId).toBe(ENTRY)

    await act(async () => seen.at(-1)!.close())

    expect(router.state.location.pathname).toBe('/admin/changelog')
    expect(router.state.location.search).toEqual({ status: 'draft' })
    expect(seen.at(-1)!.open).toBe(false)
  })

  it('moves to another item and keeps the same callbacks across the change', async () => {
    const router = await mount(`/admin/changelog?status=draft&entry=${ENTRY}`)
    const { close, navigateTo } = seen.at(-1)!

    await act(async () => navigateTo(OTHER))

    expect(router.state.location.search).toEqual({ status: 'draft', entry: OTHER })
    expect(seen.at(-1)!.validatedId).toBe(OTHER)
    expect(seen.at(-1)!.close).toBe(close)
    expect(seen.at(-1)!.navigateTo).toBe(navigateTo)
  })
})
