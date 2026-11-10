// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * The canvas loads the page as a preview at a true width, and takes clicks,
 * words and undo keys from its own frame only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { canvasScale, canvasSrc, DesignerCanvas, frameBox } from '../designer-canvas'

afterEach(cleanup)

describe('frameBox', () => {
  it('draws the border outside the page, so the layer covers exactly what the page shows', () => {
    const box = frameBox({ width: 1002, height: 602 }, 1280, 'fit')
    // The border's two pixels come off the room before the page is scaled into it.
    expect(box.scale).toBeCloseTo(1000 / 1280)
    expect(box.room).toEqual({ width: 1000, height: 600 })
    expect(box.outer).toEqual({ width: 1002, height: 602 })
  })

  it('keeps a set zoom, with the border still outside the room', () => {
    const box = frameBox({ width: 500, height: 400 }, 390, 1)
    expect(box.room.width).toBe(390)
    expect(box.outer.width).toBe(392)
  })
})

describe('canvasSrc', () => {
  it('loads Home whatever the saved design leads with, in the language asked for', () => {
    expect(canvasSrc({ page: 'home', theme: 'dark', locale: 'de', sort: 'top' })).toBe(
      '/?theme=dark&preview=true&lang=de&designer=1&page=home'
    )
    expect(canvasSrc({ page: 'feedback', theme: 'light', locale: 'en', sort: 'top' })).toBe(
      '/feedback?theme=light&preview=true&lang=en&designer=1&sort=top'
    )
    expect(canvasSrc({ page: 'help', theme: 'light', locale: 'fr', sort: 'new' })).toBe(
      '/hc?theme=light&preview=true&lang=fr&designer=1'
    )
  })

  it('asks for the signed-out view, and loads a sample at its own address', () => {
    expect(
      canvasSrc({ page: 'status', theme: 'light', locale: 'en', sort: 'top', visitor: 'out' })
    ).toBe('/status?theme=light&preview=true&lang=en&designer=1&visitor=out')
    expect(
      canvasSrc({
        page: 'changelog',
        theme: 'light',
        locale: 'en',
        sort: 'top',
        postPath: '/changelog/entry_1',
      })
    ).toBe('/changelog/entry_1?theme=light&preview=true&lang=en&designer=1')
    // A sample is drawn for the designer as themselves: it is served to them alone.
    expect(
      canvasSrc({
        page: 'status',
        theme: 'light',
        locale: 'en',
        sort: 'top',
        visitor: 'out',
        sample: 'status',
      })
    ).toBe('/design-sample/status?theme=light&preview=true&lang=en&designer=1')
  })

  it('keeps the search an item carries, such as a board on the feed', () => {
    expect(
      canvasSrc({
        page: 'feedback',
        theme: 'light',
        locale: 'en',
        sort: 'top',
        postPath: '/feedback?board=bugs',
      })
    ).toBe('/feedback?theme=light&preview=true&lang=en&designer=1&sort=top&board=bugs')
  })
})

describe('DesignerCanvas', () => {
  function show(trying = false, more: Record<string, unknown> = {}) {
    const handlers = {
      ...more,
      onSelect: vi.fn(),
      onWords: vi.fn(),
      onKey: vi.fn(),
      onEscape: vi.fn(),
      onLocation: vi.fn(),
      onHover: vi.fn(),
    }
    render(
      <DesignerCanvas
        page="feedback"
        size="phone"
        theme="light"
        locale="en"
        sort="trending"
        refreshKey="1"
        design={null}
        structural={{}}
        trying={trying}
        {...handlers}
      />
    )
    const iframe = screen.getByTitle(
      trying ? 'Feedback, phone, light, preview, links work' : 'Feedback, phone, light'
    ) as HTMLIFrameElement
    const frame = { postMessage: vi.fn() } as unknown as Window
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => frame })
    const send = (data: unknown, source: Window = frame, origin = window.location.origin) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
      })
    return { ...handlers, frame, send }
  }

  it('tints its frame on a phone, where changes are phone values, but not in preview', () => {
    show()
    const frameOf = (title: string) => screen.getByTitle(title).parentElement!
    expect(frameOf('Feedback, phone, light').hasAttribute('data-phone-mode')).toBe(true)
    cleanup()
    show(true)
    expect(
      frameOf('Feedback, phone, light, preview, links work').hasAttribute('data-phone-mode')
    ).toBe(false)
  })

  it('hands on a click, the pointer, words and undo from its frame', () => {
    const { send, onSelect, onHover, onWords, onKey } = show()
    send({ type: 'quackback:preview-section', section: 'band' })
    send({ type: 'quackback:preview-section', section: 'feed', link: '/b/ideas/posts/p1' })
    send({ type: 'quackback:preview-section', section: null, link: '//elsewhere.example.com' })
    send({ type: 'quackback:preview-pointer', section: 'feed' })
    send({ type: 'quackback:preview-pointer', section: 7 })
    send({ type: 'quackback:preview-words', field: 'home.title', text: 'Hi' })
    send({ type: 'quackback:preview-key', key: 'redo' })
    expect(onSelect).toHaveBeenCalledWith('band', null, null)
    expect(onSelect).toHaveBeenCalledWith('feed', '/b/ideas/posts/p1', null)
    // Empty canvas lets go; a link off the portal is no link.
    expect(onSelect).toHaveBeenCalledWith(null, null, null)
    expect(onHover).toHaveBeenNthCalledWith(1, 'feed', null)
    expect(onHover).toHaveBeenNthCalledWith(2, null, null)
    expect(onWords).toHaveBeenCalledWith('home.title', 'Hi')
    expect(onKey).toHaveBeenCalledWith('redo')
  })

  it('hands a click or double-click on a menu item to the menu, in place of picking', () => {
    const onMenu = vi.fn()
    const onMenuHover = vi.fn()
    const { send, onSelect } = show(false, { onMenu, onMenuHover })
    send({ type: 'quackback:preview-section', section: 'header', link: '/', menu: 'roadmap' })
    send({ type: 'quackback:preview-section', section: 'header', link: null, menu: 'evil' })
    send({ type: 'quackback:preview-rename', menu: 'link:abc' })
    send({ type: 'quackback:preview-pointer', section: 'header', menu: 'logo' })
    send({ type: 'quackback:preview-pointer', section: 'header' })
    expect(onMenu.mock.calls).toEqual([
      ['roadmap', 'click', null],
      ['link:abc', 'rename'],
    ])
    // A name that is no menu item is a click on the header.
    expect(onSelect).toHaveBeenCalledWith('header', null, null)
    expect(onMenuHover.mock.calls).toEqual([['logo'], [null]])
  })

  it('hands on a right-click from its own frame, where it was in the builder’s window', () => {
    const onContext = vi.fn()
    const onMenu = vi.fn()
    const { send } = show(false, { onContext, onMenu })
    const iframe = screen.getByTitle('Feedback, phone, light')
    // The frame drawn at half its width, 100px in and 50px down.
    iframe.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 195, height: 400 }) as DOMRect
    Object.defineProperty(iframe, 'offsetWidth', { configurable: true, value: 390 })
    send({ type: 'quackback:preview-context', section: 'block-a1', x: 40, y: 20 })
    expect(onContext).toHaveBeenCalledExactlyOnceWith('block-a1', null, { x: 120, y: 60 })
    // Not from its frame: nothing.
    send({ type: 'quackback:preview-context', section: 'block-a1', x: 1, y: 1 }, window)
    send(
      { type: 'quackback:preview-context', section: 'block-a1', x: 1, y: 1 },
      undefined,
      'https://evil.example.com'
    )
    expect(onContext).toHaveBeenCalledOnce()
    // A menu item's actions are its click menu.
    send({ type: 'quackback:preview-context', section: 'header', menu: 'roadmap', x: 1, y: 1 })
    expect(onMenu).toHaveBeenCalledExactlyOnceWith('roadmap', 'click', null)
    expect(onContext).toHaveBeenCalledOnce()
  })

  it('follows a link clicked with Ctrl or Cmd held, in place of picking', () => {
    const onFollow = vi.fn()
    const { send, onSelect } = show(false, { onFollow })
    send({ type: 'quackback:preview-section', section: 'feed', link: '/status', follow: true })
    send({ type: 'quackback:preview-section', section: 'feed', link: null, follow: true })
    expect(onFollow).toHaveBeenCalledExactlyOnceWith('/status')
    // With no link there, it is a click like any other.
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('feed', null, null)
  })

  it('ignores messages from any other window, and malformed ones', () => {
    const { send, onSelect, onKey } = show()
    send({ type: 'quackback:preview-section', section: 'band' }, {} as Window)
    send({ type: 'quackback:preview-key', key: 'rm -rf' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onKey).not.toHaveBeenCalled()
  })

  it('tells a freshly loaded frame it is designed, and nothing of what is picked', () => {
    const { send, frame } = show()
    send({ type: 'quackback:preview-ready' })
    const told = vi.mocked(frame.postMessage).mock.calls.map(([message]) => message)
    expect(told.slice(-2)).toStrictEqual([
      { type: 'quackback:preview-designer', trying: false },
      { type: 'quackback:preview-theme', theme: 'light' },
    ])
  })

  it('draws light or dark in the page it shows, and loads another page afresh', () => {
    const { frame } = show()
    const props = {
      page: 'feedback' as const,
      size: 'phone' as const,
      locale: 'en',
      sort: 'trending' as const,
      design: null,
      structural: {},
      onSelect: vi.fn(),
      onWords: vi.fn(),
      onKey: vi.fn(),
    }
    const before = screen.getByTitle('Feedback, phone, light') as HTMLIFrameElement
    const src = before.getAttribute('src')
    cleanup()
    const view = render(<DesignerCanvas {...props} theme="light" />)
    const shown = view.container.querySelector('iframe')!
    Object.defineProperty(shown, 'contentWindow', { configurable: true, get: () => frame })
    vi.mocked(frame.postMessage).mockClear()
    view.rerender(<DesignerCanvas {...props} theme="dark" />)
    // The same frame, at the address it loaded, told to draw dark.
    expect(view.container.querySelector('iframe')).toBe(shown)
    expect(shown.getAttribute('src')).toBe(src)
    expect(frame.postMessage).toHaveBeenCalledWith(
      { type: 'quackback:preview-theme', theme: 'dark' },
      window.location.origin
    )
    view.rerender(<DesignerCanvas {...props} theme="dark" page="roadmap" />)
    expect(view.container.querySelector('iframe')).not.toBe(shown)
    expect(view.container.querySelector('iframe')!.getAttribute('src')).toContain('theme=dark')
  })

  it('in Preview, tells the frame to act as a visitor’s and takes Tab', () => {
    const { send, frame } = show(true)
    send({ type: 'quackback:preview-ready' })
    const told = vi.mocked(frame.postMessage).mock.calls.map(([message]) => message)
    expect(told).toContainEqual({ type: 'quackback:preview-designer', trying: true })
    expect(screen.getByTitle(/preview, links work/).tabIndex).toBe(0)
  })

  it('hands on an Escape the page did not take, from its own frame only', () => {
    const { send, onEscape } = show(false)
    send({ type: 'quackback:preview-key', key: 'escape' }, {} as Window)
    expect(onEscape).not.toHaveBeenCalled()
    send({ type: 'quackback:preview-key', key: 'escape' })
    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('in Preview, follows where its own frame says it is, and nothing else', () => {
    const { send, frame, onLocation } = show(true)
    send({ type: 'quackback:preview-location', path: '/changelog/entry_1' }, {} as Window)
    send(
      { type: 'quackback:preview-location', path: '/changelog/entry_1' },
      frame,
      'https://elsewhere.example.com'
    )
    send({ type: 'quackback:preview-location', path: 'https://elsewhere.example.com/x' })
    send({ type: 'quackback:preview-location', path: 42 })
    expect(onLocation).not.toHaveBeenCalled()
    send({ type: 'quackback:preview-location', path: '/changelog/entry_1' })
    expect(onLocation).toHaveBeenCalledExactlyOnceWith('/changelog/entry_1')
    // A page says where it is as soon as it is ready, too.
    send({ type: 'quackback:preview-ready', path: '/roadmap' })
    expect(onLocation).toHaveBeenLastCalledWith('/roadmap')
  })

  it('follows nothing while editing', () => {
    const { send, onLocation } = show()
    send({ type: 'quackback:preview-location', path: '/roadmap' })
    expect(onLocation).not.toHaveBeenCalled()
  })

  it('draws the skeleton, busy, until its own frame says it is ready', () => {
    const { send, frame } = show(false, { skeleton: <p>Loading shapes</p> })
    const box = document.querySelector('[data-canvas-box]')!
    expect(box.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Loading shapes')).toBeTruthy()
    send({ type: 'quackback:preview-ready' }, {} as Window)
    expect(screen.queryByText('Loading shapes')).not.toBeNull()
    send({ type: 'quackback:preview-ready' }, frame)
    expect(screen.queryByText('Loading shapes')).toBeNull()
    expect(box.getAttribute('aria-busy')).toBe('false')
  })

  it('keeps the skeleton, when asked, until the frame says it drew the design given', () => {
    const { send, frame } = show(false, { skeleton: <p>Loading shapes</p>, untilDrawn: true })
    send({ type: 'quackback:preview-ready' }, frame)
    // Ready, but still drawing the published design: the skeleton stays.
    expect(screen.queryByText('Loading shapes')).not.toBeNull()
    send({ type: 'quackback:preview-drawn' }, {} as Window)
    expect(screen.queryByText('Loading shapes')).not.toBeNull()
    send({ type: 'quackback:preview-drawn' }, frame)
    expect(screen.queryByText('Loading shapes')).toBeNull()
  })

  it('offers no Try it of its own', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Try it' })).toBeNull()
  })
})

describe('canvasScale', () => {
  it('fits the room unless a scale is set, and never enlarges a page to fit', () => {
    expect(canvasScale(640, 1280, 'fit')).toBe(0.5)
    expect(canvasScale(2000, 1280, 'fit')).toBe(1)
    expect(canvasScale(320, 1280, 0.75)).toBe(0.75)
  })
})
