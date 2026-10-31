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

  it('adds nothing for a plain band with no headline, but draws a styled one', () => {
    root.portalDesign = view(null)
    expect(mount().container.innerHTML).toBe('')
    cleanup()
    root.portalDesign = view(null, 'brand')
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
})
