// @vitest-environment happy-dom
/**
 * The Help Center home title and description: the admin's own words, the
 * defaults in the page's language, or, in the admin preview, the unpublished
 * words from the Customise page.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { useHelpCenterLandingCopy } from '../use-help-center-landing-copy'
import { PreviewDraftProvider } from '@/components/public/preview-draft-context'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

afterEach(cleanup)

function Copy({ config }: { config: Partial<HelpCenterConfig> | null }) {
  const { title, description } = useHelpCenterLandingCopy(config as HelpCenterConfig | null)
  return (
    <>
      <h1>{title}</h1>
      <p>{description}</p>
    </>
  )
}

function renderCopy(config: Partial<HelpCenterConfig> | null, wrap?: (ui: ReactNode) => ReactNode) {
  const ui = <Copy config={config} />
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      {wrap ? wrap(ui) : ui}
    </IntlProvider>
  )
}

describe('useHelpCenterLandingCopy', () => {
  it('shows the saved words', () => {
    renderCopy({ homepageTitle: 'Acme help', homepageDescription: 'Answers' })
    expect(screen.getByRole('heading').textContent).toBe('Acme help')
    expect(screen.getByText('Answers')).toBeTruthy()
  })

  it('shows the draft words in the admin preview', () => {
    renderCopy({ homepageTitle: 'Acme help', homepageDescription: 'Answers' }, (ui) => (
      <PreviewDraftProvider
        draft={{ helpCenter: { homepageTitle: 'Draft title', homepageDescription: 'Draft words' } }}
        css=""
      >
        {ui}
      </PreviewDraftProvider>
    ))
    expect(screen.getByRole('heading').textContent).toBe('Draft title')
    expect(screen.getByText('Draft words')).toBeTruthy()
  })

  it('words a draft equal to the default like the default', () => {
    renderCopy({ homepageTitle: 'Acme help' }, (ui) => (
      <PreviewDraftProvider draft={{ helpCenter: { homepageTitle: 'How can we help?' } }} css="">
        {ui}
      </PreviewDraftProvider>
    ))
    expect(screen.getByRole('heading').textContent).toBe('How can we help?')
  })
})
