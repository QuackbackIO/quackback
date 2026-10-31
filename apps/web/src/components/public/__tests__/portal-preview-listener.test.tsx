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

/** Posts a message and waits for the design channel to load. */
async function postDesign(data: unknown) {
  post(data)
  await act(async () => {
    await vi.dynamicImportSettled()
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

  // The saved theme sets the font and radius on body (and the font family with
  // !important), which beats a draft that only sets them on :root.
  it('applies the draft font and radius where the saved theme sets them', () => {
    const saved = document.createElement('style')
    saved.textContent =
      'body { --radius: 0.5rem; } html body { font-family: "Roboto", sans-serif !important; }'
    document.head.append(saved)
    post({
      type: 'quackback:preview-css',
      css: ':root { --radius: 1rem; --font-sans: "Inter", sans-serif; }',
    })

    const body = getComputedStyle(document.body)
    expect(body.getPropertyValue('--radius').trim()).toBe('1rem')
    expect(body.fontFamily.replaceAll('"', '')).toBe('Inter, sans-serif')
    saved.remove()
  })

  it('treats an emptied stylesheet as no draft', () => {
    post({ type: 'quackback:preview-css', css: ':root {}' })
    post({ type: 'quackback:preview-css', css: '' })

    expect(screen.getByTestId('css').textContent).toBe('saved')
  })
})

describe('a design draft in the preview', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-qb-nav')
  })

  it('applies the draft design’s CSS and structure, then puts the saved ones back', async () => {
    document.documentElement.setAttribute('data-qb-nav', 'tabs')
    await postDesign({
      type: 'quackback:preview-design',
      design: {
        css: '[data-portal-theme] { --qb-accent: #0f766e; }',
        attributes: { 'data-qb-nav': 'pills' },
        fontIds: [],
      },
    })
    expect(document.querySelector('style[data-preview-design]')?.textContent).toContain(
      '--qb-accent: #0f766e'
    )
    expect(document.documentElement.getAttribute('data-qb-nav')).toBe('pills')

    await postDesign({ type: 'quackback:preview-design', design: null })
    expect(document.querySelector('style[data-preview-design]')).toBeNull()
    expect(document.documentElement.getAttribute('data-qb-nav')).toBe('tabs')
  })

  it('ignores attributes outside the design’s own', async () => {
    await postDesign({
      type: 'quackback:preview-design',
      design: { css: '', attributes: { onload: 'x', 'data-qb-band': 'tint' }, fontIds: [] },
    })
    expect(document.documentElement.hasAttribute('onload')).toBe(false)
    expect(document.documentElement.getAttribute('data-qb-band')).toBe('tint')
    await postDesign({ type: 'quackback:preview-design', design: null })
    expect(document.documentElement.hasAttribute('data-qb-band')).toBe(false)
  })
})

describe('picking a section in a design preview', () => {
  const sent: unknown[] = []
  const designMessage = {
    type: 'quackback:preview-design',
    design: { css: '', attributes: {}, fontIds: [], headline: null },
  }

  beforeEach(() => {
    sent.length = 0
    vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
      sent.push(message)
    })
  })

  function section(name: string, inner = '<p>text</p>') {
    const element = document.createElement('div')
    element.setAttribute('data-qb-section', name)
    element.innerHTML = inner
    document.body.appendChild(element)
    return element
  }

  it('reports the section clicked, but not a click on a link in it', async () => {
    await postDesign(designMessage)
    const band = section('band', '<p>Headline</p><a href="/x">Link</a>')
    band.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    band.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(
      sent.filter((m) => (m as { type: string }).type === 'quackback:preview-section')
    ).toEqual([{ type: 'quackback:preview-section', section: 'band' }])
    band.remove()
  })

  it('stays out of the way until a design is previewed', () => {
    const band = section('band')
    band.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(
      sent.filter((m) => (m as { type: string }).type === 'quackback:preview-section')
    ).toEqual([])
    band.remove()
  })
})
