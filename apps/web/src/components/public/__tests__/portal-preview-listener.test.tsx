// @vitest-environment happy-dom
/**
 * The admin settings page posts its unsaved drafts into the portal preview
 * frame. Each draft reaches only what reads it: the theme editor's stylesheet
 * does not re-render the portal home (which reads the welcome card), and a
 * welcome card edit does not hand the header a new navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { designView } from '@/lib/shared/design/design-view'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

/** The published design, as the route context carries it. */
const root = vi.hoisted(() => ({ portalDesign: undefined as unknown }))
/** The frame's router: where the page loads ahead for a link, and how it moves. */
const router = vi.hoisted(() => ({
  preloadRoute: async (_options: unknown): Promise<unknown> => [],
  navigate: async (_options: unknown): Promise<void> => {},
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ settings: { portalDesign: root.portalDesign } }),
  useRouter: () => router,
}))

import { PortalPreviewProvider } from '../portal-preview-listener'
import { useFeedCopy, usePortalDesign } from '../preview-draft-context'
import {
  usePreviewCss,
  usePreviewDraft,
  usePreviewNav,
  usePreviewWelcomeCard,
} from '../preview-draft-context'

const renders = { nav: 0, welcomeCard: 0, css: 0, pages: 0 }

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
function PagesReader() {
  renders.pages++
  const design = usePortalDesign()
  const v2 = design?.engine === 'v2' ? design : undefined
  return (
    <p data-testid="pages">
      {JSON.stringify({
        blocks: v2?.home.blocks.map((block) => block.type) ?? null,
        nav: v2?.nav.items.map((item) => item.type) ?? null,
      })}
    </p>
  )
}

/** A draft design: the default one, changed as asked. */
function draftDesign(change: (draft: PortalDesign) => void = () => {}): PortalDesign {
  const draft = defaultDesign()
  change(draft)
  return draft
}

/** The page that frames the preview. */
const framer = { postMessage: vi.fn() } as unknown as Window

function post(data: unknown, source: Window = framer) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: window.location.origin, source })
    )
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
  renders.pages = 0
  // The provider listens only inside a frame.
  vi.spyOn(window, 'top', 'get').mockReturnValue(framer)
  vi.spyOn(window, 'parent', 'get').mockReturnValue(framer)
  render(
    <PortalPreviewProvider enabled>
      <NavReader />
      <WelcomeCardReader />
      <CssReader />
      <DraftReader />
      <PagesReader />
    </PortalPreviewProvider>
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  root.portalDesign = undefined
})

describe('PortalPreviewProvider', () => {
  it('starts on the saved config', () => {
    expect(screen.getByTestId('welcome').textContent).toBe('saved')
    expect(screen.getByTestId('css').textContent).toBe('saved')
    expect(screen.getByTestId('draft').textContent).toBe('none')
  })

  it('shows parts as they are, whatever state a message names', async () => {
    const header = document.createElement('div')
    header.setAttribute('data-qb-section', 'header')
    document.body.append(header)
    for (const state of ['hover', 'focus']) {
      await postDesign({ type: 'quackback:preview-designer', state })
      expect(header.getAttributeNames().filter((name) => name.startsWith('data-qb-force'))).toEqual(
        []
      )
      expect(document.querySelector('style[data-qb-forced]')).toBeNull()
    }
    header.remove()
  })

  it('fetches nothing ahead for a link while designing, and does while trying', async () => {
    const preload = vi.fn(async () => [])
    router.preloadRoute = preload
    await postDesign({ type: 'quackback:preview-designer', state: null })
    await router.preloadRoute({ to: '/b/ideas/posts/p1' })
    expect(preload).not.toHaveBeenCalled()
    await postDesign({ type: 'quackback:preview-designer', trying: true })
    await router.preloadRoute({ to: '/b/ideas/posts/p1' })
    expect(preload).toHaveBeenCalledOnce()
  })

  it('draws in light or dark in place, as asked, keeping its page', () => {
    const navigate = vi.fn(async () => {})
    router.navigate = navigate
    post({ type: 'quackback:preview-theme', theme: 'dark' })
    expect(navigate).toHaveBeenCalledOnce()
    const [options] = navigate.mock.calls[0] as unknown as [
      { search: (prev: object) => object; replace: boolean; resetScroll: boolean },
    ]
    expect(options.search({ preview: true, theme: 'light' })).toEqual({
      preview: true,
      theme: 'dark',
    })
    expect(options).toMatchObject({ replace: true, resetScroll: false })
    // Already drawn in it, or asked for something else: nothing moves.
    window.history.replaceState(null, '', '/?theme=dark')
    post({ type: 'quackback:preview-theme', theme: 'dark' })
    post({ type: 'quackback:preview-theme', theme: 'sepia' })
    expect(navigate).toHaveBeenCalledOnce()
    window.history.replaceState(null, '', '/')
  })

  it('picks on a click while designing, and lets clicks act while trying', async () => {
    const button = document.createElement('button')
    button.setAttribute('data-qb-section', 'header')
    document.body.append(button)
    const click = () => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      return event.defaultPrevented
    }
    await postDesign({ type: 'quackback:preview-designer', state: null })
    expect(click()).toBe(true)
    // The builder outlines what is picked, over the frame; the page is never marked.
    expect(button.hasAttribute('data-qb-selected')).toBe(false)
    await postDesign({ type: 'quackback:preview-designer', trying: true })
    expect(click()).toBe(false)
    button.remove()
  })

  it('draws no columns over Home, whatever a message asks', async () => {
    const home = document.createElement('div')
    home.setAttribute('data-qb-section', 'home')
    document.body.append(home)
    await postDesign({ type: 'quackback:preview-designer', grid: true })
    expect(document.querySelector('[data-qb-grid]')).toBeNull()
    home.remove()
  })

  it('ignores a message from anything but the page that frames it', () => {
    post({ type: 'quackback:preview-css', css: ':root { --font-sans: Inter }' }, {} as Window)

    expect(screen.getByTestId('css').textContent).toBe('saved')
  })

  it('re-renders only the stylesheet reader for a stylesheet draft', () => {
    post({ type: 'quackback:preview-css', css: ':root { --font-sans: Inter }' })

    expect(screen.getByTestId('css').textContent).toBe(':root { --font-sans: Inter }')
    expect(renders).toMatchObject({ nav: 1, welcomeCard: 1, css: 2 })
  })

  it('keeps the navigation as it was when only the welcome card changes', () => {
    post({ type: 'quackback:preview-draft', draft: { nav, welcomeCard: { body: 'Hi' } } })
    post({
      type: 'quackback:preview-draft',
      draft: { nav: structuredClone(nav), welcomeCard: { body: 'Hello' } },
    })

    expect(screen.getByTestId('welcome').textContent).toBe('Hello')
    expect(screen.getByTestId('nav').textContent).toBe(JSON.stringify(nav))
    expect(renders).toMatchObject({ nav: 2, welcomeCard: 3, css: 1 })
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
  const attributes = Object.keys(designView(defaultDesign(), null).attributes)
  afterEach(() => {
    for (const name of [...attributes, 'data-qb-header'])
      document.documentElement.removeAttribute(name)
  })

  it('says it drew a draft design once it has, and not before', async () => {
    const drawn = () =>
      vi
        .mocked(framer.postMessage)
        .mock.calls.filter(
          ([message]) => (message as { type?: string }).type === 'quackback:preview-drawn'
        )
    expect(drawn()).toEqual([])
    await postDesign({ type: 'quackback:preview-design', design: draftDesign() })
    expect(drawn()).toEqual([[{ type: 'quackback:preview-drawn' }, window.location.origin]])
  })

  it('says at once that it drew a design sent again, drawing nothing anew', async () => {
    const drawn = () =>
      vi
        .mocked(framer.postMessage)
        .mock.calls.filter(
          ([message]) => (message as { type?: string }).type === 'quackback:preview-drawn'
        ).length
    await postDesign({ type: 'quackback:preview-design', design: draftDesign() })
    const pages = renders.pages
    expect(drawn()).toBe(1)
    // The same design afresh, as the builder reads it back after a publish.
    await postDesign({ type: 'quackback:preview-design', design: draftDesign() })
    expect(drawn()).toBe(2)
    expect(renders.pages).toBe(pages)
  })

  it('draws the draft with the view the server builds for it, then puts the saved one back', async () => {
    document.documentElement.setAttribute('data-qb-header', 'saved')
    const draft = draftDesign((d) => {
      d.css = '[data-qb-part="band"] { letter-spacing: 0.02em; }'
    })
    const view = designView(draft, null)
    await postDesign({ type: 'quackback:preview-design', design: draft })
    expect(document.querySelector('style[data-preview-design]')?.textContent).toBe(
      `${view.themeStyles}\n${view.customCss}`
    )
    for (const [name, value] of Object.entries(view.attributes))
      expect(document.documentElement.getAttribute(name), name).toBe(value)

    await postDesign({ type: 'quackback:preview-design', design: null })
    expect(document.querySelector('style[data-preview-design]')).toBeNull()
    expect(document.documentElement.getAttribute('data-qb-header')).toBe('saved')
  })

  it('outlines sections on hover for Appearance, but not in the designer, whose builder draws it', async () => {
    const design = draftDesign()
    await postDesign({ type: 'quackback:preview-design', design })
    expect(document.querySelector('style[data-preview-sections]')).not.toBeNull()
    await postDesign({ type: 'quackback:preview-designer' })
    await postDesign({ type: 'quackback:preview-design', design })
    expect(document.querySelector('style[data-preview-sections]')).toBeNull()
  })

  it('hands the page the draft’s design where it reads the published one', async () => {
    const pages = () => JSON.parse(screen.getByTestId('pages').textContent ?? '{}')
    expect(pages()).toEqual({ blocks: null, nav: null })
    const draft = draftDesign((d) => {
      d.pages.home.blocks = [
        { id: 'status01', type: 'status', grid: { x: 0, y: 0, w: 4, h: 4 } },
        {
          id: 'ideas001',
          type: 'ideas',
          grid: { x: 0, y: 4, w: 6, h: 8 },
          sort: 'trending',
          count: 3,
        },
      ]
    })
    await postDesign({ type: 'quackback:preview-design', design: draft })
    expect(pages()).toEqual({
      blocks: ['status', 'ideas'],
      nav: draft.nav.items.map((item) => item.type),
    })
    await postDesign({ type: 'quackback:preview-design', design: null })
    expect(pages()).toEqual({ blocks: null, nav: null })
  })

  it('uses nothing from a design the schema refuses', async () => {
    const forged = {
      ...draftDesign(),
      css: ':root{}',
      attributes: { onload: 'x' },
      pages: { home: { blocks: [{ type: 'script' }] } },
    }
    await postDesign({ type: 'quackback:preview-design', design: forged })
    expect(document.querySelector('style[data-preview-design]')).toBeNull()
    expect(document.documentElement.hasAttribute('onload')).toBe(false)
    expect(JSON.parse(screen.getByTestId('pages').textContent ?? '{}')).toEqual({
      blocks: null,
      nav: null,
    })
  })
})

describe('picking a section in a design preview', () => {
  const sent: unknown[] = []
  const designMessage = {
    type: 'quackback:preview-design',
    design: defaultDesign(),
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

describe('a design draft’s own wording in the preview', () => {
  it('replaces the saved wording before it is published', async () => {
    cleanup()
    const saved = draftDesign((d) => {
      d.pages.feedback.copy = { prompt: { en: 'Saved prompt' } }
    })
    root.portalDesign = designView(saved, 3)
    function Copy() {
      return <p data-testid="copy">{useFeedCopy().prompt ?? 'none'}</p>
    }
    render(
      <IntlProvider locale="en" onError={() => {}}>
        <PortalPreviewProvider enabled>
          <Copy />
        </PortalPreviewProvider>
      </IntlProvider>
    )
    expect(screen.getByTestId('copy').textContent).toBe('Saved prompt')
    const draft = draftDesign((d) => {
      d.pages.feedback.copy = { prompt: { en: 'Draft prompt' } }
    })
    await postDesign({ type: 'quackback:preview-design', design: draft })
    expect(screen.getByTestId('copy').textContent).toBe('Draft prompt')
  })
})

describe('the designer’s frame before designing starts', () => {
  beforeEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/feedback?designer=1')
    vi.mocked(framer.postMessage).mockClear()
    render(<PortalPreviewProvider enabled>page</PortalPreviewProvider>)
  })
  afterEach(() => window.history.replaceState(null, '', '/'))

  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('holds every key, but hands Escape to the designer so Preview can be left', () => {
    expect(press('Enter')).toBe(true)
    expect(framer.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quackback:preview-key' }),
      expect.anything()
    )
    expect(press('Escape')).toBe(true)
    expect(framer.postMessage).toHaveBeenCalledWith(
      { type: 'quackback:preview-key', key: 'escape' },
      window.location.origin
    )
  })
})
