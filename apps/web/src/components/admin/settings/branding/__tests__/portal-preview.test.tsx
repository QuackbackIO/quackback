// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * <PortalPreview> frames the real portal and pushes the page's unsaved
 * drafts into it over postMessage, on two channels: the theme stylesheet and
 * the structural draft (navigation, welcome card). The saved config already
 * renders natively in the frame, and every message re-renders the portal
 * page, so a channel's draft goes in only while it holds an unsaved edit and
 * only when it changes; a discard puts the saved values back.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { PortalPreview } from '../portal-preview'

type Props = ComponentProps<typeof PortalPreview>

const savedDraft = { nav: { items: [] } }
const saved: Props = {
  theme: 'light',
  path: '/',
  refreshKey: 'saved-1',
  draftCss: ':root { --primary: red; }',
  cssDirty: false,
  draft: savedDraft,
  draftDirty: false,
  device: 'desktop',
}

/** The frame's window: a recorder (happy-dom never loads the page). */
let frameWindow: { postMessage: ReturnType<typeof vi.fn> }

/** Swap the frame's window for a recorder. */
function recordFrame() {
  const postMessage = vi.fn()
  frameWindow = { postMessage }
  const iframe = screen.getByTitle<HTMLIFrameElement>('Portal preview')
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    get: () => frameWindow,
  })
  return postMessage
}

/** A message from the frame (or, with `source`, from some other window). */
function fromFrame(data: unknown, source: unknown = frameWindow) {
  act(() => {
    fireEvent(
      window,
      new MessageEvent('message', {
        data,
        origin: window.location.origin,
        source: source as MessageEventSource,
      })
    )
  })
}

/** The portal's listener announcing itself, as it does after every (re)load. */
const frameReady = () => fromFrame({ type: 'quackback:preview-ready' })

const src = () => screen.getByTitle('Portal preview').getAttribute('src')

const debounce = () => act(() => vi.advanceTimersByTime(200))
const sent = (post: ReturnType<typeof vi.fn>) => post.mock.calls.map(([msg]) => msg)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PortalPreview', () => {
  it.each(['desktop', 'mobile'] as const)(
    'lays its overlay over the %s frame itself, after the page',
    (device) => {
      render(<PortalPreview {...saved} device={device} overlay={<div data-testid="over" />} />)
      const iframe = screen.getByTitle('Portal preview')
      const frame = iframe.parentElement!
      const layer = screen.getByTestId('over').parentElement!
      expect(layer.parentElement).toBe(frame)
      expect(iframe.nextElementSibling).toBe(layer)
      expect(frame.className).toContain('relative')
      expect(layer.className).toContain('absolute')
      expect(layer.className).toContain('inset-0')
      expect(layer.className).toContain('pointer-events-none')
      // The scale the frame is drawn at, for an overlay that keeps its own size.
      expect(frame.style.getPropertyValue('--preview-scale')).toBe('1')
    }
  )

  it('sends drafts at once when the flush key changes, without the typing pause', () => {
    const dirty = { ...saved, cssDirty: true, draftDirty: true }
    const { rerender } = render(<PortalPreview {...dirty} flushKey={null} />)
    const post = recordFrame()
    frameReady()
    post.mockClear()

    // An ordinary edit waits out the pause.
    rerender(<PortalPreview {...dirty} draftCss=":root { --primary: blue; }" flushKey={null} />)
    expect(post).not.toHaveBeenCalled()
    debounce()
    expect(sent(post)).toEqual([
      { type: 'quackback:preview-css', css: ':root { --primary: blue; }' },
    ])
    post.mockClear()

    // An import lands whole: its stylesheet and structure go in with no wait, once.
    const imported = { nav: { items: [] } }
    rerender(
      <PortalPreview
        {...dirty}
        draftCss=":root { --primary: green; }"
        draft={imported}
        flushKey="import-1"
      />
    )
    expect(sent(post)).toEqual([
      { type: 'quackback:preview-css', css: ':root { --primary: green; }' },
      { type: 'quackback:preview-draft', draft: imported },
    ])
    debounce()
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('outlines the changed parts after the change itself has gone to the frame', () => {
    const dirty = { ...saved, cssDirty: true, draftDirty: true }
    const { rerender } = render(<PortalPreview {...dirty} flash={null} />)
    const post = recordFrame()
    frameReady()
    post.mockClear()

    // A chat change lands with its outlines: the draft first, with no typing pause.
    rerender(
      <PortalPreview
        {...dirty}
        draftCss=":root { --header: navy; }"
        flash={{ targets: ['header', 'colours'] }}
      />
    )
    expect(sent(post)).toEqual([
      { type: 'quackback:preview-css', css: ':root { --header: navy; }' },
      { type: 'quackback:preview-flash', targets: ['header', 'colours'] },
    ])
    debounce()
    expect(post).toHaveBeenCalledTimes(2)

    // The same flash is not sent again by a later render.
    post.mockClear()
    const flash = { targets: ['nav' as const] }
    rerender(<PortalPreview {...dirty} draftCss=":root { --header: navy; }" flash={flash} />)
    rerender(<PortalPreview {...dirty} draftCss=":root { --header: navy; }" flash={flash} />)
    expect(sent(post)).toEqual([{ type: 'quackback:preview-flash', targets: ['nav'] }])
  })

  it('sends no outlines for a change with none', () => {
    const { rerender } = render(<PortalPreview {...saved} flash={null} />)
    const post = recordFrame()
    frameReady()
    post.mockClear()
    rerender(<PortalPreview {...saved} flash={{ targets: [] }} />)
    expect(sent(post).filter((m) => m.type === 'quackback:preview-flash')).toEqual([])
  })

  it('adds no layer without an overlay', () => {
    render(<PortalPreview {...saved} />)
    expect(screen.getByTitle('Portal preview').nextElementSibling).toBeNull()
  })

  it.each(['tablet', 'mobile'] as const)(
    'draws the %s frame with the thin edge desktop has, no thick bezel',
    (device) => {
      render(<PortalPreview {...saved} device={device} />)
      const frame = screen.getByTitle('Portal preview').parentElement!
      expect(frame.style.borderWidth).toBe('')
      expect(frame.className).toContain('border-border')
      expect(frame.className).not.toContain('border-foreground')
    }
  )

  it('frames the portal home at its canonical address', () => {
    render(<PortalPreview {...saved} theme="dark" />)
    expect(src()).toBe('/?theme=dark&preview=true&sort=trending')
  })

  it('frames the page it is given', () => {
    render(<PortalPreview {...saved} path="/hc" />)
    expect(src()).toBe('/hc?theme=light&preview=true')
  })

  it('keeps the page the frame moved to when the theme or saved config reloads it', () => {
    const onLocation = vi.fn()
    const { rerender } = render(<PortalPreview {...saved} onLocation={onLocation} />)
    recordFrame()
    fromFrame({ type: 'quackback:preview-location', path: '/changelog' })
    expect(onLocation).toHaveBeenCalledWith('/changelog')
    // The parent follows the frame: that is not a new page to load.
    rerender(<PortalPreview {...saved} path="/changelog" onLocation={onLocation} />)
    expect(src()).toBe('/?theme=light&preview=true&sort=trending')

    rerender(<PortalPreview {...saved} path="/changelog" theme="dark" onLocation={onLocation} />)
    expect(src()).toBe('/changelog?theme=dark&preview=true')

    rerender(
      <PortalPreview
        {...saved}
        path="/changelog"
        theme="dark"
        refreshKey="saved-2"
        onLocation={onLocation}
      />
    )
    expect(src()).toBe('/changelog?theme=dark&preview=true')
  })

  it('loads a page the admin picks', () => {
    const { rerender } = render(<PortalPreview {...saved} />)
    rerender(<PortalPreview {...saved} path="/roadmap" />)
    expect(src()).toBe('/roadmap?theme=light&preview=true')
  })

  it('listens to its own frame only', () => {
    const onLocation = vi.fn()
    const onPick = vi.fn()
    const edited = { ...saved, draftCss: ':root { --primary: blue; }', cssDirty: true }
    render(<PortalPreview {...edited} onLocation={onLocation} onPick={onPick} />)
    const post = recordFrame()

    const other = { postMessage: vi.fn() }
    fromFrame({ type: 'quackback:preview-ready' }, other)
    fromFrame({ type: 'quackback:preview-location', path: '/hc' }, other)
    fromFrame({ type: 'quackback:preview-pick', target: 'logo' }, null)

    expect(post).not.toHaveBeenCalled()
    expect(onLocation).not.toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('forwards a pick from its frame', () => {
    const onPick = vi.fn()
    render(<PortalPreview {...saved} onPick={onPick} />)
    recordFrame()
    fromFrame({ type: 'quackback:preview-pick', target: 'welcome' })
    expect(onPick).toHaveBeenCalledWith('welcome')
  })

  it('turns edit mode on in each document the frame loads', () => {
    const editLabels = { logo: 'Logo' }
    render(<PortalPreview {...saved} editLabels={editLabels} />)
    const post = recordFrame()
    frameReady()
    expect(sent(post)).toEqual([
      { type: 'quackback:preview-edit-mode', enabled: true, labels: editLabels },
    ])
  })

  it('sends nothing to a frame while there is nothing unsaved', () => {
    render(<PortalPreview {...saved} />)
    const post = recordFrame()
    fireEvent.load(screen.getByTitle('Portal preview'))
    frameReady()
    debounce()
    expect(post).not.toHaveBeenCalled()
  })

  it('sends an unsaved theme alone, and clears it on discard', () => {
    const { rerender } = render(<PortalPreview {...saved} />)
    const post = recordFrame()
    frameReady()

    rerender(<PortalPreview {...saved} draftCss=":root { --primary: blue; }" cssDirty />)
    debounce()
    expect(sent(post)).toEqual([
      { type: 'quackback:preview-css', css: ':root { --primary: blue; }' },
    ])

    post.mockClear()
    rerender(<PortalPreview {...saved} />)
    debounce()
    expect(sent(post)).toEqual([{ type: 'quackback:preview-css', css: '' }])
  })

  it('sends an unsaved navigation or welcome card alone, and the saved one on discard', () => {
    const { rerender } = render(<PortalPreview {...saved} />)
    const post = recordFrame()
    frameReady()

    const edited = { nav: { items: [{ id: 'feedback', type: 'feedback' as const }] } }
    rerender(<PortalPreview {...saved} draft={edited} draftDirty />)
    debounce()
    expect(sent(post)).toEqual([{ type: 'quackback:preview-draft', draft: edited }])

    post.mockClear()
    const discarded = { nav: { items: [] } }
    rerender(<PortalPreview {...saved} draft={discarded} />)
    debounce()
    expect(sent(post)).toEqual([{ type: 'quackback:preview-draft', draft: discarded }])
  })

  it('re-sends unsaved drafts to a reloaded frame once, and nothing once they are saved', () => {
    const edited = { ...saved, draftCss: ':root { --primary: blue; }', cssDirty: true }
    const { rerender } = render(<PortalPreview {...edited} />)
    let post = recordFrame()
    fireEvent.load(screen.getByTitle('Portal preview'))
    frameReady()
    debounce()
    expect(sent(post)).toEqual([
      { type: 'quackback:preview-css', css: ':root { --primary: blue; }' },
    ])

    // A save lands: the frame reloads showing the new saved config natively.
    rerender(<PortalPreview {...saved} refreshKey="saved-2" draftCss={edited.draftCss} />)
    post = recordFrame()
    fireEvent.load(screen.getByTitle('Portal preview'))
    frameReady()
    debounce()
    expect(post).not.toHaveBeenCalled()
  })
})
