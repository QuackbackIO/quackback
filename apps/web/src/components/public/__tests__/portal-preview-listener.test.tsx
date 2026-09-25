// @vitest-environment happy-dom
/**
 * The admin settings page posts its unsaved drafts into the portal preview
 * frame. Each draft reaches only what reads it: the theme editor's stylesheet
 * does not re-render the portal home (which reads the welcome card), and a
 * welcome card edit does not hand the header a new navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { PortalPreviewProvider } from '../portal-preview-listener'
import {
  usePreviewCss,
  usePreviewDraft,
  usePreviewNav,
  usePreviewWelcomeCard,
} from '../preview-draft-context'

const renders = { nav: 0, welcomeCard: 0, css: 0 }

function NavReader() {
  renders.nav++
  return <p data-testid="nav">{JSON.stringify(usePreviewNav() ?? null)}</p>
}
function WelcomeCardReader() {
  renders.welcomeCard++
  const body = usePreviewWelcomeCard()?.body
  return <p data-testid="welcome">{typeof body === 'string' ? body : 'saved'}</p>
}
function CssReader() {
  renders.css++
  return <p data-testid="css">{usePreviewCss() ?? 'saved'}</p>
}
function DraftReader() {
  return <p data-testid="draft">{usePreviewDraft() ? 'draft' : 'none'}</p>
}

function post(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin }))
  })
}

const nav = { items: [{ type: 'feedback' }] }

beforeEach(() => {
  renders.nav = 0
  renders.welcomeCard = 0
  renders.css = 0
  // The provider listens only inside a frame.
  vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
  render(
    <PortalPreviewProvider enabled>
      <NavReader />
      <WelcomeCardReader />
      <CssReader />
      <DraftReader />
    </PortalPreviewProvider>
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PortalPreviewProvider', () => {
  it('starts on the saved config', () => {
    expect(screen.getByTestId('welcome').textContent).toBe('saved')
    expect(screen.getByTestId('css').textContent).toBe('saved')
    expect(screen.getByTestId('draft').textContent).toBe('none')
  })

  it('re-renders only the stylesheet reader for a stylesheet draft', () => {
    post({ type: 'quackback:preview-css', css: ':root { --font-sans: Inter }' })

    expect(screen.getByTestId('css').textContent).toBe(':root { --font-sans: Inter }')
    expect(renders).toEqual({ nav: 1, welcomeCard: 1, css: 2 })
  })

  it('keeps the navigation as it was when only the welcome card changes', () => {
    post({ type: 'quackback:preview-draft', draft: { nav, welcomeCard: { body: 'Hi' } } })
    post({
      type: 'quackback:preview-draft',
      draft: { nav: structuredClone(nav), welcomeCard: { body: 'Hello' } },
    })

    expect(screen.getByTestId('welcome').textContent).toBe('Hello')
    expect(screen.getByTestId('nav').textContent).toBe(JSON.stringify(nav))
    expect(renders).toEqual({ nav: 2, welcomeCard: 3, css: 1 })
  })

  it('treats an emptied stylesheet as no draft', () => {
    post({ type: 'quackback:preview-css', css: ':root {}' })
    post({ type: 'quackback:preview-css', css: '' })

    expect(screen.getByTestId('css').textContent).toBe('saved')
  })
})
