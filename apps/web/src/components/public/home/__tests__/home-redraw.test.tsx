// @vitest-environment happy-dom
/**
 * In the builder's canvas, a change to the look alone, such as a colour or a
 * text size the stylesheet repaints, draws none of Home's blocks again; a
 * change to Home itself does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { PreviewDesignContext, type DraftDesignView } from '../../preview-draft-context'

const drawn = vi.hoisted(() => ({ blocks: 0 }))
vi.mock('../home-blocks', async (original) => {
  const actual = await original<typeof import('../home-blocks')>()
  return {
    ...actual,
    HomeBlockView: (props: Parameters<typeof actual.HomeBlockView>[0]) => {
      drawn.blocks++
      return actual.HomeBlockView(props)
    },
  }
})
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: async () => [],
  fetchBoardCapabilitiesFn: async () => ({ permissions: {}, boards: [] }),
  fetchPublicPosts: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: vi.fn(),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))

const { PortalHome } = await import('../portal-home')

afterEach(cleanup)

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const home = { blocks: [{ type: 'contact', width: 'full' }] }
const view = (themeStyles: string, ofHome: unknown = home) =>
  ({
    engine: 'v2',
    attributes: {},
    themeStyles,
    home: ofHome,
    feedback: { headline: null },
  }) as unknown as DraftDesignView

let show: (next: DraftDesignView) => void = () => {}

async function mount() {
  function Framed() {
    const [shown, setShown] = useState(view('a{}'))
    show = setShown
    return (
      <PreviewDesignContext.Provider value={shown}>
        <PortalHome gates={GATES} />
      </PreviewDesignContext.Provider>
    )
  }
  const root = createRootRouteWithContext<object>()({
    beforeLoad: () => ({ settings: { portalDesign: view('a{}') as never } }),
  })
  const page = createRoute({ getParentRoute: () => root, path: '/', component: Framed })
  const others = ['/feedback', '/support'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null })
  )
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
  const rendered = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await waitFor(() =>
    expect(rendered.container.querySelector('[data-qb-section=home]')).not.toBeNull()
  )
}

describe('Home in the canvas', () => {
  it('draws no block again for a change to the look alone, and does for a change to Home', async () => {
    await mount()
    const before = drawn.blocks
    expect(before).toBeGreaterThan(0)
    act(() => show(view('a{color:red}')))
    expect(drawn.blocks).toBe(before)
    act(() => show(view('a{color:red}', { blocks: [{ type: 'contact', width: 'half' }] })))
    expect(drawn.blocks).toBeGreaterThan(before)
  })
})
