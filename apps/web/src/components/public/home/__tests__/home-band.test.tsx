// @vitest-environment happy-dom
/**
 * Home's composer can sit in the band under the headline, leaving the grid to
 * the other blocks; a full-width contact block lays out as one row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
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

async function mountHome(home: Record<string, unknown>, gates = GATES, locale = 'en') {
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
      <IntlProvider locale={locale} onError={() => {}}>
        <RouterProvider router={router} />
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
    expect(band.querySelector('[data-qb-part=composer]')).not.toBeNull()
    expect(
      band.querySelector('[data-qb-part=composer] button[data-qb-label]')!.className
    ).toContain('bg-[var(--qb-action-bg,var(--primary))]')
    const grid = page.querySelector('[data-qb-section=home]')!
    expect(grid.querySelector('[data-qb-part=composer]')).toBeNull()
    // The contact block keeps its place in the order, for the preview's section picking.
    expect(grid.querySelector('[data-qb-block=contact]')!.getAttribute('data-qb-section')).toBe(
      'block-1'
    )
  })

  it('names a block with an id by it, so the name follows the block when blocks move', async () => {
    const blocks = BLOCKS.map((block, i) => ({ ...block, id: `blockname${i}` }))
    const page = await mountHome({ headline: null, blocks, composer: 'band' })
    const grid = page.querySelector('[data-qb-section=home]')!
    expect(grid.querySelector('[data-qb-block=contact]')!.getAttribute('data-qb-section')).toBe(
      'block-blockname1'
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
    // Its way on is centred with the row's words, not pinned to the top.
    const action = page.querySelector('[data-qb-block=contact] [data-qb-link]')!
    expect(action.className).toContain('md:self-center')
  })
})

describe('a block’s own heading and look', () => {
  const links = {
    type: 'links',
    id: 'linksblock1',
    width: 'full',
    links: [{ label: 'Site', url: 'https://example.com' }],
    heading: { en: 'Elsewhere', de: 'Anderswo' },
    look: { tone: 'brand', align: 'centre' },
  }

  it('heads a block in the visitor’s language, and marks the words for the designer', async () => {
    const page = await mountHome({ headline: null, blocks: [links] }, GATES, 'de')
    const heading = page.querySelector('[data-qb-block=links] h2')!
    expect(heading.textContent).toBe('Anderswo')
    expect(heading.getAttribute('data-qb-words')).toBe('block-linksblock1.heading')
  })

  it('draws a block in the brand colour, centred, over the site’s cards', async () => {
    const page = await mountHome({ headline: null, blocks: [links] })
    const block = page.querySelector<HTMLElement>('[data-qb-block=links]')!
    expect(block.getAttribute('data-qb-tone')).toBe('brand')
    expect(block.style.getPropertyValue('--qb-tone-fill')).toContain('--qb-accent')
    expect(block.style.background).toContain('--qb-tone-fill')
    expect(block.className).toContain('text-center')
  })

  it('leaves the card off a plain block, and keeps the site’s on the rest', async () => {
    const page = await mountHome({
      headline: null,
      blocks: [
        { type: 'contact', width: 'full', look: { tone: 'plain' } },
        { type: 'contact', width: 'full' },
      ],
    })
    const [plain, card] = page.querySelectorAll('[data-qb-block=contact]')
    expect(plain!.hasAttribute('data-qb-surface')).toBe(false)
    expect(card!.getAttribute('data-qb-surface')).toBe('card')
  })
})
