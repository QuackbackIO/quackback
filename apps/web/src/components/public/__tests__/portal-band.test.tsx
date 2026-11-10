// @vitest-environment happy-dom
/**
 * The band at the top of the feedback page shows the design's headline in the
 * visitor's language, a draft headline in the preview, and nothing on legacy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const root = vi.hoisted(() => ({ portalDesign: undefined as unknown }))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ settings: { portalDesign: root.portalDesign } }),
}))

const frame = vi.hoisted(() => ({ current: null as null | { visitor: 'in' | 'out' } }))
vi.mock('@/lib/client/designer-frame', () => ({ thisDesignerFrame: () => frame.current }))

import { PortalBand, textForLocale } from '../portal-band'
import { PreviewHeadlineContext, PreviewPagesContext } from '../preview-draft-context'

const view = (headline: unknown, band = 'none') => ({
  engine: 'v2',
  attributes: { 'data-qb-band': band },
  feedback: { welcome: null, headline },
  home: { headline, blocks: [] },
  titles: { roadmap: headline },
})

afterEach(() => {
  cleanup()
  root.portalDesign = undefined
  frame.current = null
})

describe('textForLocale', () => {
  it('stops at English when asked, so the caller’s own words follow', () => {
    expect(textForLocale({ de: 'Neues' }, 'en')).toBe('Neues')
    expect(textForLocale({ de: 'Neues' }, 'en', { anyLanguage: false })).toBeUndefined()
    expect(textForLocale({ en: 'New', de: 'Neues' }, 'fr', { anyLanguage: false })).toBe('New')
  })

  it('takes the visitor’s language, its base, then English, then any', () => {
    expect(textForLocale({ en: 'Ideas', 'pt-br': 'Ideias' }, 'pt-br')).toBe('Ideias')
    expect(textForLocale({ en: 'Ideas', de: 'Ideen' }, 'de-AT')).toBe('Ideen')
    expect(textForLocale({ en: 'Ideas' }, 'fr')).toBe('Ideas')
    expect(textForLocale({ nl: 'Ideeën' }, 'fr')).toBe('Ideeën')
    expect(textForLocale(undefined, 'fr')).toBeUndefined()
  })
})

describe('PortalBand', () => {
  const mount = (draft?: unknown, page?: 'home' | 'feedback' | 'roadmap') =>
    render(
      <IntlProvider locale="de" defaultLocale="en">
        <PreviewHeadlineContext.Provider value={draft as never}>
          <PortalBand page={page} />
        </PreviewHeadlineContext.Provider>
      </IntlProvider>
    )

  it('draws nothing on the legacy theme', () => {
    root.portalDesign = { engine: 'legacy' }
    const { container } = mount()
    expect(container.innerHTML).toBe('')
  })

  it('draws no band without a headline, whatever its style', () => {
    for (const band of ['none', 'brand', 'tint', 'fade']) {
      root.portalDesign = view(null, band)
      expect(mount().container.innerHTML, band).toBe('')
      cleanup()
      // Nor in the preview, so the preview shows what visitors will see.
      expect(mount({ title: {}, subtitle: {} }).container.innerHTML, band).toBe('')
      cleanup()
    }
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'brand')
    expect(mount().container.querySelector('[data-qb-section="hero"]')).toBeTruthy()
  })

  it('shows the saved headline in the visitor’s language', () => {
    root.portalDesign = view({ title: { en: 'Ideas', de: 'Ideen' }, subtitle: { en: 'Vote' } })
    mount()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ideen')
    expect(screen.getByText('Vote')).toBeTruthy()
  })

  it('sizes the headline by its length, between a floor and a ceiling', () => {
    root.portalDesign = view({
      title: { en: 'Ideas for the road ahead' },
      subtitle: { en: 'Vote' },
    })
    mount()
    const headline = screen.getByRole('heading', { level: 1 })
    // A long headline drops in size rather than run to many lines.
    expect(headline.style.getPropertyValue('--qb-headline-chars')).toBe('24')
    expect(headline.className).toContain(
      '[font-size:max(var(--qb-headline-floor,1.875rem),min(var(--qb-headline-size),var(--qb-headline-cap,7.5rem),100cqi*var(--qb-headline-measure,4.2)/var(--qb-headline-chars)))]'
    )
    // Measured against the words' own width.
    expect(headline.parentElement!.className).toContain('[container-type:inline-size]')
  })

  it('keeps clear room above the headline and between it and its line, as it grows', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: { en: 'Vote' } })
    mount()
    const headline = screen.getByRole('heading', { level: 1 })
    // Lines never close up so far that a descender reaches the line under it.
    expect(headline.className).toContain('[line-height:max(var(--qb-headline-leading,1.2),1.04)]')
    expect(headline.className).toContain('mb-[max(0.5rem,calc(0.35em-0.5rem))]')
    expect(headline.className).toContain('mt-[max(0rem,calc(0.4em-1.25rem))]')
    // A bare hero still keeps room under the header.
    const band = document.querySelector('[data-qb-part=band]')!
    expect(band.className).toContain('[[data-qb-band=none]_&]:!pt-6')
  })

  it('balances the headline and keeps a subtitle’s last word off a line of its own', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: { en: 'Vote' } })
    mount()
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('[text-wrap:balance]')
    expect(screen.getByText('Vote').className).toContain('[text-wrap:pretty]')
  })

  it('pads a phone hero less than a wide one', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'brand')
    mount(undefined, 'home')
    const band = document.querySelector('[data-qb-part=band]')!
    expect(band.className).toContain('py-8 sm:py-10')
    expect(band.className).toContain('[[data-qb-band-height=tall]_&]:py-10')
    expect(band.className).toContain('sm:[[data-qb-band-height=tall]_&]:py-20')
    expect(band.firstElementChild!.className).toContain('pt-2 sm:pt-6')
  })

  it('takes the design’s height on Home alone; a list page’s hero is always compact', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'brand')
    for (const page of ['feedback', 'roadmap'] as const) {
      mount(undefined, page)
      const band = document.querySelector('[data-qb-part=band]')!
      expect(band.className, page).not.toContain('data-qb-band-height')
      expect(band.className, page).not.toContain('sm:py-10')
      cleanup()
    }
    mount(undefined, 'feedback')
    const band = document.querySelector('[data-qb-part=band]')!
    expect(band.className).toContain('py-5 sm:py-6')
    expect(band.className).toContain('[--qb-band-pad:1.25rem] sm:[--qb-band-pad:1.5rem]')
  })

  it('runs the composer to the words’ full width beside no image, else to a measure', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} })
    const withComposer = () =>
      render(
        <IntlProvider locale="en">
          <PortalBand page="feedback">
            <form data-testid="composer" />
          </PortalBand>
        </IntlProvider>
      )
    withComposer()
    let holder = screen.getByTestId('composer').parentElement!
    expect(holder.className).toContain('[[data-qb-band-align=centre]_&]:max-w-[40rem]')
    expect(holder.className).not.toMatch(/(^| )max-w-\[40rem\]/)
    cleanup()
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: { url: '/api/storage/portal-images/room.jpg', place: 'side' },
    }
    withComposer()
    holder = screen.getByTestId('composer').parentElement!
    expect(holder.className).toMatch(/(^| )max-w-\[40rem\]/)
  })

  it('sizes Home’s composer to its stored step, from the draft in the preview, full on phones', () => {
    const home = (composerWidth?: string) => ({
      headline: { title: { en: 'Ideas' }, subtitle: {} },
      blocks: [],
      composer: 'band',
      ...(composerWidth ? { composerWidth } : {}),
    })
    root.portalDesign = { ...view(null), home: home('narrow') }
    const withComposer = (draft?: unknown) =>
      render(
        <IntlProvider locale="en">
          <PreviewPagesContext.Provider value={draft as never}>
            <PortalBand page="home">
              <form data-testid="composer" />
            </PortalBand>
          </PreviewPagesContext.Provider>
        </IntlProvider>
      )
    withComposer()
    let holder = screen.getByTestId('composer').parentElement!
    expect(holder.className).toContain('max-w-none sm:max-w-[24rem]')
    expect(holder.className).not.toContain('max-w-[40rem]')
    // The canvas finds the composer's measure by it.
    expect(holder.hasAttribute('data-qb-band-composer')).toBe(true)
    cleanup()
    withComposer({ home: home('full') })
    holder = screen.getByTestId('composer').parentElement!
    expect(holder.className).toMatch(/(^| )max-w-none( |$)/)
    expect(holder.className).not.toContain('sm:max-w-')
    expect(holder.className).not.toContain('max-w-[40rem]')
    cleanup()
    // Left out, it keeps the measure it always had.
    withComposer({ home: home() })
    holder = screen.getByTestId('composer').parentElement!
    expect(holder.className).toContain('[[data-qb-band-align=centre]_&]:max-w-[40rem]')
    expect(holder.className).not.toContain('max-w-none')
  })

  it('shows a draft headline in the preview, even an empty one', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} })
    mount({ title: { en: 'Roadmap ideas' }, subtitle: {} })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Roadmap ideas')
    cleanup()
    mount(null)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('sets the accent phrase apart, in the visitor’s language', () => {
    root.portalDesign = view({
      title: { en: 'Charge anywhere. Shape what’s next.', de: 'Überall laden. Mitgestalten.' },
      subtitle: {},
      accent: { style: 'colour', text: { en: 'Shape what’s next.', de: 'Mitgestalten.' } },
    })
    mount()
    const accent = screen.getByText('Mitgestalten.')
    expect(accent.getAttribute('data-qb-accent')).toBe('colour')
    expect(accent.className).toContain('var(--qb-band-accent)')
    expect(screen.getByRole('heading').textContent).toBe('Überall laden. Mitgestalten.')
  })

  it('highlights a phrase, and leaves a title alone that does not hold it', () => {
    root.portalDesign = view({
      title: { en: 'Make it work harder' },
      subtitle: {},
      accent: { style: 'highlight', text: { en: 'harder' } },
    })
    mount()
    expect(screen.getByText('harder').className).toContain('var(--qb-band-highlight)')
    cleanup()
    root.portalDesign = view({
      title: { en: 'Make it work' },
      subtitle: {},
      accent: { style: 'highlight', text: { en: 'harder' } },
    })
    mount()
    expect(screen.getByRole('heading').innerHTML).toBe('Make it work')
  })

  it('sets a phrase apart lighter, as a two-tone headline’s second part', () => {
    root.portalDesign = view({
      title: { en: 'Ideas that shape Acme. Tell us what to build next' },
      subtitle: {},
      accent: { style: 'muted', text: { en: 'Tell us what to build next' } },
    })
    mount()
    const accent = screen.getByText('Tell us what to build next')
    expect(accent.getAttribute('data-qb-accent')).toBe('muted')
    expect(accent.className).toContain('var(--qb-band-muted')
  })

  it('sets a side image beside the words', () => {
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: { url: '/api/storage/portal-images/room.jpg', place: 'side' },
    }
    mount()
    const band = document.querySelector('[data-qb-part=band]')!
    const image = band.querySelector('img[data-qb-part=band-image]')!
    expect(image.getAttribute('src')).toBe('/api/storage/portal-images/room.jpg')
    expect(band.hasAttribute('data-qb-band-image')).toBe(false)
  })

  it('serves a side image at the size the screen needs, fetched first', () => {
    const srcSet =
      '/api/storage/portal-images/room-640.webp 640w,/api/storage/portal-images/room.webp 2560w'
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: { url: '/api/storage/portal-images/room.webp', place: 'side', srcSet },
    }
    mount()
    const image = document.querySelector('img[data-qb-part=band-image]')!
    expect(image.getAttribute('srcset')).toBe(srcSet)
    expect(image.getAttribute('sizes')).toBe('(min-width:768px) 50vw,100vw')
    expect(image.getAttribute('fetchpriority')).toBe('high')
  })

  it('leaves out a srcset that is not of stored files, and one an older design never had', () => {
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: {
        url: '/api/storage/portal-images/room.webp',
        place: 'side',
        srcSet: 'https://example.com/x.webp 640w',
      },
    }
    mount()
    let image = document.querySelector('img[data-qb-part=band-image]')!
    expect(image.hasAttribute('srcset')).toBe(false)
    expect(image.hasAttribute('sizes')).toBe(false)
    cleanup()
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: { url: '/api/storage/portal-images/room.jpg', place: 'side' },
    }
    mount()
    image = document.querySelector('img[data-qb-part=band-image]')!
    expect(image.hasAttribute('srcset')).toBe(false)
    expect(image.getAttribute('fetchpriority')).toBe('high')
  })

  it('puts a cover or pattern image behind the words, from storage only', () => {
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: { url: '/api/storage/portal-images/leaves.png', place: 'pattern' },
    }
    mount()
    let band = document.querySelector('[data-qb-part=band]') as HTMLElement
    expect(band.getAttribute('data-qb-band-image')).toBe('pattern')
    expect(band.style.getPropertyValue('--qb-band-image')).toBe(
      'url("/api/storage/portal-images/leaves.png")'
    )
    cleanup()
    root.portalDesign = {
      ...view({ title: { en: 'Ideas' }, subtitle: {} }),
      bandImage: { url: 'https://example.com/x.png");}body{', place: 'cover' },
    }
    mount()
    band = document.querySelector('[data-qb-part=band]') as HTMLElement
    expect(band.hasAttribute('data-qb-band-image')).toBe(false)
    expect(band.getAttribute('style')).toBeNull()
  })

  it('keeps an image along the bottom below the words, on any band, with room left for it', () => {
    for (const band of ['none', 'brand']) {
      root.portalDesign = {
        ...view({ title: { en: 'Ideas' }, subtitle: { en: 'Vote' } }, band),
        bandImage: { url: '/api/storage/portal-images/street.jpg', place: 'edge' },
      }
      mount()
      const section = document.querySelector('[data-qb-part=band]') as HTMLElement
      expect(section.getAttribute('data-qb-band-image')).toBe('edge')
      // The band's own background never draws the image, so it cannot run up behind the words.
      expect(section.className).not.toMatch(
        /data-qb-band-image=edge\]\]:\[background:var\(--qb-band-image\)/
      )
      // The image sits in a strip at the band's foot, under the words, on a band of any colour.
      const foot = section.querySelector('[data-qb-part=band-foot-image]') as HTMLElement
      expect(foot.parentElement).toBe(section)
      expect(foot.className).toContain('bottom-0')
      expect(foot.className).toContain('h-44')
      expect(section.className).toContain('sm:[&[data-qb-band-image=edge]]:!pb-44')
      cleanup()
    }
  })

  it('draws band art along the bottom or tiled, as the design marks it', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'tint')
    mount()
    const band = document.querySelector('[data-qb-part=band]')!
    expect(band.className).toContain('[[data-qb-band-art=edge]_&]:[background:var(--qb-band-art)')
  })

  it('fades tiled art out towards the band’s foot, never cut mid-motif, and leaves set-in panels bare', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'tint')
    mount()
    const band = document.querySelector('[data-qb-part=band]')!
    // The tiles are drawn under the words, on a layer of their own that a mask fades out at the foot.
    expect(band.className).toContain(
      '[[data-qb-band-art=tile]_&]:before:[background:var(--qb-band-art)_0_0/var(--qb-band-art-size)_repeat]'
    )
    expect(band.className).toMatch(
      /\[\[data-qb-band-art=tile\]_&\]:before:\[mask-image:linear-gradient\(to_bottom,[^\]]*transparent[^\]]*\)\]/
    )
    expect(band.className).toContain('[[data-qb-band-art=tile]_&]:before:pointer-events-none')
    expect(band.className).toContain('[[data-qb-band-art=tile]_&]:before:-z-10')
    expect(band.className).toContain('[[data-qb-band-art=tile]_&]:isolate')
    // The band's own fill stays the band's, so a mesh still gives way on phones under tiles.
    expect(band.className).not.toContain(
      '[[data-qb-band-art=tile]_&]:[background:var(--qb-band-art)'
    )
    expect(band.className).toContain('[[data-qb-band-shape=inset]_&]:before:hidden')
    expect(band.className).toContain('[[data-qb-band-shape=split]_&]:before:hidden')
  })

  it('gives way to a plain band on phones where the design asks, its foot laid over it so glows end before its edge', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'blend')
    mount(undefined, 'home')
    const band = document.querySelector('[data-qb-part=band]')!
    // The foot, then the fade over its bottom padding, then the plain phone band (the full band from sm up).
    expect(band.className).toContain(
      '[background:var(--qb-band-foot,none),linear-gradient(to_bottom,transparent_calc(100%-var(--qb-band-pad)),var(--qb-band-foot-pad,transparent)),var(--qb-band-bg-narrow,var(--qb-band-bg))]'
    )
    expect(band.className).toContain(
      'sm:[background:var(--qb-band-foot,none),linear-gradient(to_bottom,transparent_calc(100%-var(--qb-band-pad)),var(--qb-band-foot-pad,transparent)),var(--qb-band-bg)]'
    )
    // Its bottom padding, which a coloured band's foot fades within, at each height.
    expect(band.className).toContain('[--qb-band-pad:2.5rem]')
    expect(band.className).toContain('[[data-qb-band-height=compact]_&]:[--qb-band-pad:1.5rem]')
    expect(band.className).toContain('[[data-qb-band-height=tall]_&]:[--qb-band-pad:5rem]')
  })
})

describe('the placeholder hero', () => {
  const mount = (draft?: unknown) =>
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <PreviewHeadlineContext.Provider value={draft as never}>
          <PortalBand />
        </PreviewHeadlineContext.Provider>
      </IntlProvider>
    )

  it('stands in the builder where the page has no headline, marked as the hero', () => {
    frame.current = { visitor: 'in' }
    root.portalDesign = view(null)
    const { container } = mount()
    const hero = container.querySelector('[data-qb-section="hero"]')
    expect(hero).toBeTruthy()
    expect(hero?.hasAttribute('data-qb-placeholder')).toBe(true)
    expect(hero?.textContent).toContain('Add a headline')
    expect(hero?.textContent).toContain('Visitors see nothing here until you do')
    // Not words the design stores, so double-click does not try to edit them.
    expect(hero?.querySelector('[data-qb-words]')).toBeNull()
  })

  it('never reaches a visitor or the live portal', () => {
    root.portalDesign = view(null)
    const { container } = mount()
    expect(container.innerHTML).toBe('')
    expect(container.textContent).not.toContain('Add a headline')
  })

  it('gives way to the real hero once a headline is typed', () => {
    frame.current = { visitor: 'in' }
    root.portalDesign = view(null)
    const { container, rerender } = mount()
    expect(container.querySelector('[data-qb-placeholder]')).toBeTruthy()
    rerender(
      <IntlProvider locale="en" defaultLocale="en">
        <PreviewHeadlineContext.Provider value={{ title: { en: 'Ideas' }, subtitle: {} } as never}>
          <PortalBand />
        </PreviewHeadlineContext.Provider>
      </IntlProvider>
    )
    expect(container.querySelector('[data-qb-placeholder]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ideas')
  })
})
