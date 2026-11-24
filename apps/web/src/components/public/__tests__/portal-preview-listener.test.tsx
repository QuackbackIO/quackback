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
  usePreviewHelpCenter,
  usePreviewLogo,
  usePreviewName,
  usePreviewNav,
  usePreviewWelcomeCard,
} from '../preview-draft-context'

const renders = { nav: 0, welcomeCard: 0, css: 0, helpCenter: 0 }

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
function HelpCenterReader() {
  renders.helpCenter++
  return <p data-testid="hc">{usePreviewHelpCenter()?.homepageTitle ?? 'saved'}</p>
}
function LogoReader() {
  const logo = usePreviewLogo()
  return <p data-testid="logo">{logo ? `${logo.url}|${logo.mode}` : 'saved'}</p>
}

/** The admin page, as the frame's parent window sees it. */
const parentWindow = { postMessage: vi.fn() }

function post(data: unknown, source: unknown = parentWindow) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: window.location.origin,
        source: source as MessageEventSource,
      })
    )
  })
}

const sentToParent = () => parentWindow.postMessage.mock.calls.map(([msg]) => msg)

const nav = { items: [{ type: 'feedback' }] }

function Portal({ path = '/' }: { path?: string }) {
  return (
    <PortalPreviewProvider enabled path={path}>
      <NavReader />
      <WelcomeCardReader />
      <CssReader />
      <DraftReader />
      <HelpCenterReader />
      <LogoReader />
      <header data-qb-edit="header">
        <a href="/" data-qb-edit="logo">
          Acme
        </a>
      </header>
      <a href="/roadmap">Roadmap</a>
    </PortalPreviewProvider>
  )
}

let rerender: (ui: React.ReactElement) => void

beforeEach(() => {
  renders.nav = 0
  renders.welcomeCard = 0
  renders.css = 0
  renders.helpCenter = 0
  parentWindow.postMessage.mockClear()
  // The provider listens only inside a frame, to its parent.
  vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parentWindow as unknown as Window)
  ;({ rerender } = render(<Portal />))
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
    expect(renders).toEqual({ nav: 1, welcomeCard: 1, css: 2, helpCenter: 1 })
  })

  it('keeps the navigation as it was when only the welcome card changes', () => {
    post({ type: 'quackback:preview-draft', draft: { nav, welcomeCard: { body: 'Hi' } } })
    post({
      type: 'quackback:preview-draft',
      draft: { nav: structuredClone(nav), welcomeCard: { body: 'Hello' } },
    })

    expect(screen.getByTestId('welcome').textContent).toBe('Hello')
    expect(screen.getByTestId('nav').textContent).toBe(JSON.stringify(nav))
    expect(renders).toEqual({ nav: 2, welcomeCard: 3, css: 1, helpCenter: 1 })
  })

  it('keeps the Help Center home, logo and button shape drafts', () => {
    post({
      type: 'quackback:preview-draft',
      draft: {
        nav,
        helpCenter: { homepageTitle: 'Hi there', homepageDescription: '', headerLinks: [] },
        logo: { url: 'https://cdn.example.com/wide.svg', mode: 'custom_logo' },
        buttonShape: 'corners',
      },
    })

    expect(screen.getByTestId('hc').textContent).toBe('Hi there')
    expect(screen.getByTestId('logo').textContent).toBe(
      'https://cdn.example.com/wide.svg|custom_logo'
    )
    expect(document.querySelector('style[data-preview-override]')?.textContent).toContain(
      '--radius-button: calc(var(--radius) * .75)'
    )
  })

  it('keeps the Help Center home as it was when only the navigation changes', () => {
    const helpCenter = { homepageTitle: 'Hi', homepageDescription: '', headerLinks: [] }
    post({ type: 'quackback:preview-draft', draft: { nav, helpCenter } })
    post({
      type: 'quackback:preview-draft',
      draft: { nav: { items: [] }, helpCenter: structuredClone(helpCenter) },
    })

    expect(renders.helpCenter).toBe(2)
  })

  // A pill draft over saved corners has to say so: the saved theme sets the token.
  it('resets the button token for a pill draft', () => {
    post({ type: 'quackback:preview-draft', draft: { buttonShape: 'pill' } })

    expect(document.querySelector('style[data-preview-override]')?.textContent).toContain(
      '--radius-button: var(--radius-item)'
    )
  })

  it('ignores drafts from any window but its parent', () => {
    post({ type: 'quackback:preview-css', css: ':root { --primary: red }' }, window)
    post({ type: 'quackback:preview-draft', draft: { helpCenter: { homepageTitle: 'X' } } }, null)

    expect(screen.getByTestId('css').textContent).toBe('saved')
    expect(screen.getByTestId('hc').textContent).toBe('saved')
  })

  it('tells its parent where it is, on load and after each navigation', () => {
    expect(sentToParent()).toContainEqual({ type: 'quackback:preview-location', path: '/' })

    rerender(<Portal path="/roadmap" />)

    expect(sentToParent()).toContainEqual({ type: 'quackback:preview-location', path: '/roadmap' })
  })

  it('lets clicks through until its parent turns edit mode on', () => {
    const logo = screen.getByText('Acme')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      logo.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    expect(sentToParent().some((m) => m.type === 'quackback:preview-pick')).toBe(false)
  })

  it('in edit mode, a click on a target picks it instead of navigating', () => {
    post({ type: 'quackback:preview-edit-mode', enabled: true, labels: { logo: 'Logo' } })

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      screen.getByText('Acme').dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    // The innermost target wins over the header around it.
    expect(sentToParent()).toContainEqual({ type: 'quackback:preview-pick', target: 'logo' })
  })

  it('in edit mode, a click outside every target still navigates', () => {
    post({ type: 'quackback:preview-edit-mode', enabled: true, labels: {} })

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      screen.getByText('Roadmap').dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
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

  // An uploaded font rides in the draft, never in the stylesheet text: its
  // faces come from the shared theme extras and the family leads the stack.
  it('loads and applies the draft uploaded font over the saved theme', () => {
    const saved = document.createElement('style')
    saved.textContent = 'html body { font-family: "Roboto", sans-serif !important; }'
    document.head.append(saved)
    post({
      type: 'quackback:preview-css',
      css: ':root { --font-sans: "Lora", ui-serif, Georgia, serif; }',
    })
    post({
      type: 'quackback:preview-draft',
      draft: {
        customFont: {
          family: 'Brand Sans',
          fallback: 'lora',
          files: [{ key: 'fonts/2026/11/a-brand.woff2', weight: 400, style: 'normal' }],
        },
      },
    })

    const sheet = document.querySelector('style[data-preview-override]')?.textContent ?? ''
    expect(sheet).toContain('@font-face { font-family: "Brand Sans"')
    expect(sheet).toContain('url("/api/storage/fonts/2026/11/a-brand.woff2")')
    expect(getComputedStyle(document.body).fontFamily.replaceAll('"', '')).toBe(
      'Brand Sans, Lora, ui-serif, Georgia, serif'
    )
    saved.remove()
  })

  // Uploading a font whose fallback is the font already in use leaves the
  // stylesheet as it was, so no stylesheet draft is sent at all.
  it('applies a draft uploaded font with no stylesheet draft', () => {
    const saved = document.createElement('style')
    saved.textContent = 'html body { font-family: "Inter", sans-serif !important; }'
    document.head.append(saved)
    post({
      type: 'quackback:preview-draft',
      draft: {
        customFont: {
          family: 'Brand Sans',
          fallback: 'lora',
          files: [{ key: 'fonts/2026/11/a-brand.woff2', weight: 400, style: 'normal' }],
        },
      },
    })

    expect(getComputedStyle(document.body).fontFamily.replaceAll('"', '')).toBe(
      'Brand Sans, Lora, ui-serif, Georgia, serif'
    )
    saved.remove()
  })

  describe('the headings font', () => {
    const MANROPE = '"Manrope", ui-sans-serif, system-ui, sans-serif'
    const headingVar = () =>
      getComputedStyle(document.body).getPropertyValue('--font-heading').trim()
    let saved: HTMLStyleElement
    beforeEach(() => {
      // The saved theme sets a headings font on :root and .dark.
      saved = document.createElement('style')
      saved.textContent =
        ':root { --font-heading: "Lora", serif; } .dark { --font-heading: "Lora", serif; }'
      document.head.append(saved)
    })
    afterEach(() => saved.remove())

    it('applies the draft’s listed font over the saved one', () => {
      post({ type: 'quackback:preview-css', css: `:root { --font-heading: ${MANROPE}; }` })
      post({ type: 'quackback:preview-draft', draft: { cardStyle: 'border' } })
      expect(headingVar()).toBe(MANROPE)
    })

    const sheet = () => document.querySelector('style[data-preview-override]')?.textContent ?? ''

    it('goes back to the text font when the draft sets none, over a saved one', () => {
      post({ type: 'quackback:preview-css', css: ':root { --font-sans: "Inter", sans-serif; }' })
      post({ type: 'quackback:preview-draft', draft: { cardStyle: 'border' } })
      // Emptied on the body: a heading falls back to the text font where it is drawn.
      expect(sheet()).toMatch(/body \{[^}]*--font-heading: initial;/)
    })

    it('leaves the saved font alone with no draft, or a stylesheet draft the editor sent nothing else for', () => {
      expect(sheet()).not.toContain('--font-heading')
      post({ type: 'quackback:preview-css', css: ':root { --font-sans: "Inter", sans-serif; }' })
      expect(sheet()).not.toContain('--font-heading')
    })

    it('puts a draft uploaded family ahead of the text font, with its faces', () => {
      post({
        type: 'quackback:preview-draft',
        draft: {
          customHeadingFont: {
            family: 'Northwind Display',
            fallback: 'inter',
            files: [{ key: 'fonts/2026/11/h-600.woff2', weight: 600, style: 'normal' }],
          },
        },
      })
      const sheet = document.querySelector('style[data-preview-override]')?.textContent ?? ''
      expect(sheet).toContain('@font-face { font-family: "Northwind Display"')
      expect(sheet).toContain('--font-heading: "Northwind Display", var(--font-sans)')
    })
  })

  describe('the card style', () => {
    const sheet = () => document.querySelector('style[data-preview-override]')?.textContent ?? ''

    it('writes a draft style from the draft’s own colours, on both sides', () => {
      post({
        type: 'quackback:preview-css',
        css: ':root { --background: #f6f5f2; --foreground: #1b1b1f; } .dark { --background: #111413; --foreground: #e8ebe9; }',
      })
      post({ type: 'quackback:preview-draft', draft: { cardStyle: 'flat' } })
      expect(sheet()).toMatch(
        /:root \{ --portal-card-border: transparent; --portal-card-shadow: none; --portal-card-background: #[\da-f]{6}; --portal-card-inset: var\(--card\); --portal-card-ink-min: initial; --portal-card-ink-max: 0\.44; \}/
      )
      expect(sheet()).toMatch(/\.dark \{ --portal-card-border: transparent;/)
    })

    it('says Border out loud, over a saved Shadow', () => {
      post({ type: 'quackback:preview-css', css: ':root { --background: #ffffff; }' })
      post({ type: 'quackback:preview-draft', draft: { cardStyle: 'border' } })
      expect(sheet()).toContain(':root { --portal-card-border: initial;')
    })

    // With no stylesheet the frame shows the saved theme, whose own card
    // variables were worked out from its own colours: a draft that only
    // repeats the saved style (a tab edit, Before, Live) must not redo them
    // from colours it does not have.
    it('leaves the saved theme’s cards alone when no stylesheet comes with the draft', () => {
      post({ type: 'quackback:preview-draft', draft: { cardStyle: 'flat', name: 'Northwind' } })
      expect(sheet()).not.toContain('--portal-card')
    })

    it('writes nothing for a draft that names no style', () => {
      post({ type: 'quackback:preview-draft', draft: { buttonShape: 'pill' } })
      expect(sheet()).not.toContain('--portal-card')
    })
  })

  it('carries the draft name to what reads it', () => {
    function NameReader() {
      return <p data-testid="name">{usePreviewName() ?? 'saved'}</p>
    }
    cleanup()
    render(
      <PortalPreviewProvider enabled>
        <NameReader />
      </PortalPreviewProvider>
    )
    expect(screen.getByTestId('name').textContent).toBe('saved')
    post({ type: 'quackback:preview-draft', draft: { name: 'Northwind' } })
    expect(screen.getByTestId('name').textContent).toBe('Northwind')
  })

  it('treats an emptied stylesheet as no draft', () => {
    post({ type: 'quackback:preview-css', css: ':root {}' })
    post({ type: 'quackback:preview-css', css: '' })

    expect(screen.getByTestId('css').textContent).toBe('saved')
  })

  describe('outlines for a change', () => {
    const outlines = () =>
      [...document.querySelectorAll<HTMLElement>('[data-preview-flash]')].map(
        (el) => el.dataset.previewFlash
      )

    beforeEach(() => {
      vi.useFakeTimers()
      // happy-dom lays nothing out: give every part a box.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 10,
        top: 20,
        width: 300,
        height: 40,
        right: 310,
        bottom: 60,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      })
    })
    afterEach(() => vi.useRealTimers())

    it('outlines one element for each target, for about a second and a half', () => {
      post({ type: 'quackback:preview-flash', targets: ['header', 'logo'] })
      expect(outlines()).toEqual(['header', 'logo'])
      const box = document.querySelector<HTMLElement>('[data-preview-flash="header"]')!
      // Around the part, drawn over the page and never taking the pointer.
      expect(box.style.position).toBe('fixed')
      expect(box.style.left).toBe('8px')
      expect(box.style.width).toBe('304px')
      expect(box.style.pointerEvents).toBe('none')
      expect(box.closest('[aria-hidden="true"]')).not.toBeNull()

      act(() => vi.advanceTimersByTime(1400))
      expect(outlines()).toEqual(['header', 'logo'])
      act(() => vi.advanceTimersByTime(200))
      expect(outlines()).toEqual([])
    })

    it('keeps the outline of a full-width part inside the page, where it shows', () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: 56,
        right: window.innerWidth,
        bottom: 56,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      post({ type: 'quackback:preview-flash', targets: ['header'] })
      const box = document.querySelector<HTMLElement>('[data-preview-flash="header"]')!
      expect(box.style.left).toBe('3px')
      expect(box.style.top).toBe('3px')
      expect(box.style.width).toBe(`${window.innerWidth - 6}px`)
      expect(box.style.height).toBe('55px')
    })

    it('holds a still outline for the same time with reduced motion', () => {
      post({ type: 'quackback:preview-flash', targets: ['header'] })
      const rules = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
      expect(rules).toMatch(
        /prefers-reduced-motion: reduce\)\s*\{\s*\[data-preview-flash\]\s*\{\s*animation: none/
      )
    })

    it('skips a target the page does not have', () => {
      post({ type: 'quackback:preview-flash', targets: ['welcome', 'header'] })
      expect(outlines()).toEqual(['header'])
    })

    it('starts over for a second change', () => {
      post({ type: 'quackback:preview-flash', targets: ['header'] })
      act(() => vi.advanceTimersByTime(1000))
      post({ type: 'quackback:preview-flash', targets: ['logo'] })
      act(() => vi.advanceTimersByTime(1000))
      expect(outlines()).toEqual(['logo'])
      act(() => vi.advanceTimersByTime(600))
      expect(outlines()).toEqual([])
    })

    it('draws nothing for more than three targets, or for anything that is not a list of names', () => {
      post({ type: 'quackback:preview-flash', targets: ['header', 'logo', 'nav', 'welcome'] })
      expect(outlines()).toEqual([])
      post({ type: 'quackback:preview-flash', targets: 'header' })
      post({ type: 'quackback:preview-flash', targets: [{ header: true }, '"] , body, [x="'] })
      expect(outlines()).toEqual([])
    })

    it('ignores a flash from any window but its parent', () => {
      post({ type: 'quackback:preview-flash', targets: ['header'] }, {})
      expect(outlines()).toEqual([])
    })
  })
})
