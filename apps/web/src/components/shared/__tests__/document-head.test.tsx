// @vitest-environment happy-dom
/**
 * The document renders again on every navigation, a search-only one included,
 * and the router's head tags (~80 on an admin page: meta, preload links,
 * stylesheets) all rendered with it. The head renders only when its tags
 * change, and then only the tags that changed, while the title and meta
 * still follow the route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// The router's own head parts, wrapped to count renders.
const tagRenders: string[] = []
let headContentRenders = 0
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  const Asset = (props: Parameters<typeof actual.Asset>[0]) => {
    tagRenders.push(
      props.tag === 'title' ? `title:${String(props.children)}` : JSON.stringify(props.attrs)
    )
    return <actual.Asset {...props} />
  }
  const HeadContent = () => {
    headContentRenders++
    return <actual.HeadContent />
  }
  return { ...actual, Asset, HeadContent }
})

const {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} = await import('@tanstack/react-router')
const { DocumentHead, RouteHeadTags } = await import('../document-head')

afterEach(() => {
  cleanup()
  tagRenders.length = 0
})

let head: 'document' | 'tags' = 'tags'

/** Renders on every navigation, as the root document does. */
function Document() {
  const href = useRouterState({ select: (s) => s.location.href })
  return (
    <>
      {head === 'document' ? <DocumentHead /> : <RouteHeadTags />}
      <p data-testid="href">{href}</p>
      <Outlet />
    </>
  )
}

function buildRouter() {
  const rootRoute = createRootRoute({
    head: () => ({
      meta: [{ name: 'viewport', content: 'width=device-width' }],
      links: [{ rel: 'icon', href: '/favicon.ico' }],
    }),
    component: Document,
  })
  const pageA = createRoute({
    getParentRoute: () => rootRoute,
    path: '/a',
    validateSearch: (search: Record<string, unknown>) => search as { tab?: string },
    head: () => ({ meta: [{ title: 'Page A' }, { name: 'description', content: 'About A' }] }),
    component: () => <p>A</p>,
  })
  const pageB = createRoute({
    getParentRoute: () => rootRoute,
    path: '/b',
    head: () => ({ meta: [{ title: 'Page B' }, { name: 'description', content: 'About B' }] }),
    component: () => <p>B</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([pageA, pageB]),
    history: createMemoryHistory({ initialEntries: ['/a'] }),
  })
}

async function mountAtA() {
  const router = buildRouter()
  render(<RouterProvider router={router} />)
  await screen.findByText('A')
  return router
}

function headTags(selector: string) {
  return Array.from(document.head.querySelectorAll(selector))
}

describe('document head', () => {
  it('does not render the head for a navigation that leaves its tags alone', async () => {
    head = 'document'
    const router = await mountAtA()
    const settled = headContentRenders
    expect(settled).toBeGreaterThan(0)

    await act(() => router.navigate({ to: '/a' as never, search: { tab: 'two' } as never }))

    expect(screen.getByTestId('href')).toHaveTextContent('/a?tab=two')
    expect(headContentRenders).toBe(settled)
    expect(document.title).toBe('Page A')
  })

  it('renders no tag again when the document renders with the same tags', async () => {
    head = 'tags'
    const router = await mountAtA()
    tagRenders.length = 0

    await act(() => router.navigate({ to: '/a' as never, search: { tab: 'two' } as never }))

    expect(screen.getByTestId('href')).toHaveTextContent('/a?tab=two')
    expect(tagRenders).toEqual([])
    expect(document.title).toBe('Page A')
  })

  it('renders only the tags a route change replaced, and keeps one of each', async () => {
    head = 'tags'
    const router = await mountAtA()
    tagRenders.length = 0

    await act(() => router.navigate({ to: '/b' as never }))
    await screen.findByText('B')

    expect(tagRenders.sort()).toEqual(
      ['title:Page B', JSON.stringify({ name: 'description', content: 'About B' })].sort()
    )
    expect(document.title).toBe('Page B')
    expect(headTags('title')).toHaveLength(1)
    expect(headTags('meta[name="description"]').map((m) => m.getAttribute('content'))).toEqual([
      'About B',
    ])
    expect(headTags('meta[name="viewport"]')).toHaveLength(1)
  })
})
