// @vitest-environment happy-dom
/**
 * Home's composer can sit in the band under the headline, leaving the grid to
 * the other blocks; a full-width contact block lays out as one row.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { PortalHome } from '../portal-home'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const BLOCKS = [
  { type: 'composer', width: 'full' },
  { type: 'contact', width: 'full' },
]

async function mountHome(home: Record<string, unknown>, gates = GATES) {
  const root = createRootRouteWithContext<object>()({
    beforeLoad: () => ({
      settings: {
        portalDesign: { engine: 'v2', attributes: {}, home, feedback: { headline: null } } as never,
      },
    }),
  })
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <PortalHome gates={gates} />,
  })
  const others = ['/feedback', '/support'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null })
  )
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" onError={() => {}}>
        <PortalWordsIntl>
          <RouterProvider router={router} />
        </PortalWordsIntl>
      </IntlProvider>
    </QueryClientProvider>
  )
  await waitFor(() => expect(view.container.querySelector('[data-qb-section=home]')).not.toBeNull())
  return view.container
}

afterEach(cleanup)

describe('Home’s composer in the band', () => {
  it('sits in the band, with a filled button, and leaves the grid', async () => {
    const page = await mountHome({ headline: null, blocks: BLOCKS, composer: 'band' })
    const band = page.querySelector('[data-qb-part=band]')!
    expect(band.querySelector('form[data-qb-part=composer]')).not.toBeNull()
    expect(band.querySelector('button[type=submit]')!.className).toContain(
      'bg-[var(--qb-action-bg,var(--primary))]'
    )
    const grid = page.querySelector('[data-qb-section=home]')!
    expect(grid.querySelector('[data-qb-part=composer]')).toBeNull()
    // The contact block keeps its place in the order, for the preview's section picking.
    expect(grid.querySelector('[data-qb-block=contact]')!.getAttribute('data-qb-section')).toBe(
      'block-1'
    )
  })

  it('stays on the grid without the choice, and with Feedback off is drawn nowhere', async () => {
    const onGrid = await mountHome({ headline: null, blocks: BLOCKS })
    expect(onGrid.querySelector('[data-qb-part=band]')).toBeNull()
    expect(onGrid.querySelector('[data-qb-section=home] [data-qb-part=composer]')).not.toBeNull()
    cleanup()
    const off = await mountHome(
      { headline: null, blocks: BLOCKS, composer: 'band' },
      { ...GATES, feedback: false }
    )
    expect(off.querySelector('[data-qb-part=composer]')).toBeNull()
  })

  it('lays a full-width contact block out as one row', async () => {
    const page = await mountHome({ headline: null, blocks: BLOCKS })
    expect(page.querySelector('[data-qb-block=contact]')!.className).toContain('md:flex-row')
  })
})
