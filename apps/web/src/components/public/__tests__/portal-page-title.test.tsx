// @vitest-environment happy-dom
/**
 * The other pages' titles follow the design: plain in the headline type, or
 * on the band as Home's headline is, in the design's words where it gives
 * them and the page's usual words where it does not.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
} from '@tanstack/react-router'
import { PortalPageTitle } from '../portal-page-title'

async function mount(portalDesign: unknown) {
  const root = createRootRouteWithContext<object>()({
    beforeLoad: () => ({ settings: { portalDesign } as never }),
    component: () => (
      <main>
        <PortalPageTitle
          page="roadmap"
          title="Roadmap"
          subtitle="What is next"
          action={<button type="button">Subscribe</button>}
        />
      </main>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
  const view = render(
    <IntlProvider locale="en" onError={() => {}}>
      <RouterProvider router={router} />
    </IntlProvider>
  )
  await waitFor(() => expect(view.container.querySelector('main')).not.toBeNull())
  return view.container
}

const v2 = (
  attributes: Record<string, string>,
  titles: Record<string, unknown> = {},
  bandImage: unknown = null
) => ({
  engine: 'v2',
  attributes,
  titles,
  bandImage,
  feedback: { headline: null },
  home: { headline: null, blocks: [] },
})

afterEach(cleanup)

describe('a page’s title', () => {
  it('is plain in the headline type, in its usual words, with its action', async () => {
    const page = await mount(v2({ 'data-qb-page-titles': 'plain' }))
    const title = page.querySelector('h1[data-qb-part=headline]')!
    expect(title.textContent).toBe('Roadmap')
    expect(title.className).toContain('[font-size:var(--qb-page-title-size')
    expect(page.textContent).toContain('What is next')
    expect(page.querySelector('[data-qb-part=band]')).toBeNull()
    expect(page.querySelector('button')!.textContent).toBe('Subscribe')
  })

  it('sits on the band when the design puts it there, in the design’s words', async () => {
    const page = await mount(
      v2(
        { 'data-qb-page-titles': 'band' },
        {
          roadmap: {
            title: { en: 'What we are building' },
            subtitle: { en: 'Coming soon' },
            accent: { style: 'colour', text: { en: 'building' } },
          },
        }
      )
    )
    const band = page.querySelector('[data-qb-part=band]')!
    expect(band.querySelector('h1')!.textContent).toBe('What we are building')
    expect(band.querySelector('[data-qb-accent=colour]')!.textContent).toBe('building')
    expect(band.textContent).toContain('Coming soon')
    expect(band.querySelector('button')!.textContent).toBe('Subscribe')
    // Its buttons inherit the band's ink, so they read on it.
    expect(band.querySelector('button')!.parentElement!.className).toContain(
      'text-[var(--qb-band-ink)]'
    )
  })

  it('keeps the band short: an image beside the words is Home’s, one behind them stays', async () => {
    const beside = await mount(
      v2({ 'data-qb-page-titles': 'band' }, {}, { url: '/api/storage/a.jpg', place: 'side' })
    )
    expect(beside.querySelector('[data-qb-part=band-image]')).toBeNull()
    cleanup()
    const behind = await mount(
      v2({ 'data-qb-page-titles': 'band' }, {}, { url: '/api/storage/a.jpg', place: 'cover' })
    )
    expect(behind.querySelector('[data-qb-part=band]')!.getAttribute('data-qb-band-image')).toBe(
      'cover'
    )
  })

  it('is left to the page outside the design engine', async () => {
    const page = await mount({ engine: 'legacy' })
    expect(page.querySelector('h1')).toBeNull()
  })
})
