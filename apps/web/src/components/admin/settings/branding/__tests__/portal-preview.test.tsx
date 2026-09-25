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
  refreshKey: 'saved-1',
  draftCss: ':root { --primary: red; }',
  cssDirty: false,
  draft: savedDraft,
  draftDirty: false,
  viewport: 'desktop',
  workspaceName: 'Acme',
  faviconUrl: null,
}

/** Swap the frame's window for a recorder (happy-dom never loads the page). */
function recordFrame() {
  const postMessage = vi.fn()
  const iframe = screen.getByTitle<HTMLIFrameElement>('Portal preview')
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    get: () => ({ postMessage }),
  })
  return postMessage
}

/** The portal's listener announcing itself, as it does after every (re)load. */
function frameReady() {
  act(() => {
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'quackback:preview-ready' },
        origin: window.location.origin,
      })
    )
  })
}

const debounce = () => act(() => vi.advanceTimersByTime(200))
const sent = (post: ReturnType<typeof vi.fn>) => post.mock.calls.map(([msg]) => msg)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PortalPreview', () => {
  it('frames the portal home at its canonical address', () => {
    render(<PortalPreview {...saved} theme="dark" />)
    expect(screen.getByTitle('Portal preview').getAttribute('src')).toBe(
      '/?theme=dark&preview=true&sort=trending'
    )
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
