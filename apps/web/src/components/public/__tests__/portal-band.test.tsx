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

import { PortalBand, textForLocale } from '../portal-band'
import { PreviewHeadlineContext } from '../preview-draft-context'

const view = (headline: unknown, band = 'none') => ({
  engine: 'v2',
  attributes: { 'data-qb-band': band },
  feedback: { welcome: null, headline },
})

afterEach(() => {
  cleanup()
  root.portalDesign = undefined
})

describe('textForLocale', () => {
  it('takes the visitor’s language, its base, then English, then any', () => {
    expect(textForLocale({ en: 'Ideas', 'pt-br': 'Ideias' }, 'pt-br')).toBe('Ideias')
    expect(textForLocale({ en: 'Ideas', de: 'Ideen' }, 'de-AT')).toBe('Ideen')
    expect(textForLocale({ en: 'Ideas' }, 'fr')).toBe('Ideas')
    expect(textForLocale({ nl: 'Ideeën' }, 'fr')).toBe('Ideeën')
    expect(textForLocale(undefined, 'fr')).toBeUndefined()
  })
})

describe('PortalBand', () => {
  const mount = (draft?: unknown) =>
    render(
      <IntlProvider locale="de" defaultLocale="en">
        <PreviewHeadlineContext.Provider value={draft as never}>
          <PortalBand />
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
    expect(mount().container.querySelector('[data-qb-section="band"]')).toBeTruthy()
  })

  it('shows the saved headline in the visitor’s language', () => {
    root.portalDesign = view({ title: { en: 'Ideas', de: 'Ideen' }, subtitle: { en: 'Vote' } })
    mount()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ideen')
    expect(screen.getByText('Vote')).toBeTruthy()
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

  it('gives way to a plain band on phones where the design asks', () => {
    root.portalDesign = view({ title: { en: 'Ideas' }, subtitle: {} }, 'blend')
    mount()
    const band = document.querySelector('[data-qb-part=band]')!
    expect(band.className).toContain('[background:var(--qb-band-bg-narrow,var(--qb-band-bg))]')
    expect(band.className).toContain('sm:[background:var(--qb-band-bg)]')
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
})
