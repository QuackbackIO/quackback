// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * <WidgetPreview> — admin widget settings live preview.
 *
 * The preview embeds the real `/widget` app in an iframe and the real SDK
 * launcher (createLauncher) in the fake page:
 *   - The iframe targets /widget with the selected theme forced via ?theme=.
 *   - The launcher button toggles the panel open/closed.
 *   - Panel and launcher share a bottom corner (panel above, button below).
 *   - An optional greeting bubble sits above the closed launcher.
 *   - The widget's own close button messages its host (quackback:close);
 *     the preview honours it like the SDK would, but only from its own origin.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WidgetPreview } from '../widget-preview'

function sendClose(origin: string) {
  fireEvent(window, new MessageEvent('message', { data: { type: 'quackback:close' }, origin }))
}

function launcher() {
  return screen.getByRole('button', { name: /feedback widget/i })
}

describe('WidgetPreview', () => {
  beforeEach(() => {
    try {
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  it('embeds the real widget with the selected theme forced', () => {
    render(<WidgetPreview position="bottom-right" theme="dark" />)

    const iframe = screen.getByTitle<HTMLIFrameElement>('Widget preview')
    expect(iframe.getAttribute('src')).toBe('/widget?theme=dark')
  })

  it('uses the real SDK launcher button', () => {
    render(<WidgetPreview position="bottom-right" />)

    const btn = launcher()
    expect(btn.querySelector('svg')).toBeTruthy()
    expect(btn.style.position).toBe('absolute')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.className).not.toContain('bg-primary')
    expect(btn.style.backgroundColor).toBeTruthy()
  })

  it('turns the real launcher into a pill when a label is set', () => {
    render(<WidgetPreview position="bottom-right" label="Feedback" />)

    expect(launcher().textContent).toContain('Feedback')
    expect(launcher().style.borderRadius).toBe('24px')
  })

  it('toggles the panel via the launcher button', () => {
    render(<WidgetPreview position="bottom-right" />)

    fireEvent.click(launcher())
    expect(screen.queryByTitle('Widget preview')).toBeNull()

    fireEvent.click(launcher())
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
  })

  it('closes the panel when the widget posts quackback:close from our origin', () => {
    render(<WidgetPreview position="bottom-right" />)

    sendClose(window.location.origin)
    expect(screen.queryByTitle('Widget preview')).toBeNull()
  })

  it('ignores quackback:close from foreign origins', () => {
    render(<WidgetPreview position="bottom-right" />)

    sendClose('https://evil.example')
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
  })

  it('places the launcher on the configured side', () => {
    render(<WidgetPreview position="bottom-left" />)

    expect(launcher().style.left).toBe('0px')
    expect(launcher().style.right).toBe('')
  })

  it('stacks the open panel above the launcher in the same corner', () => {
    render(<WidgetPreview position="bottom-right" />)

    const panel = screen.getByTitle('Widget preview').parentElement
    const btn = launcher()
    expect(panel?.className).toContain('bottom-[88px]')
    expect(btn.style.bottom).toBe('0px')
    expect(btn.style.right).toBe('0px')
    expect(panel?.parentElement?.className).toContain('w-[400px]')
    expect(panel?.parentElement?.parentElement?.className).toContain('items-center')
    expect(panel?.parentElement?.parentElement?.className).toContain('justify-center')
  })

  it('shows the launcher greeting bubble while the panel is closed', () => {
    render(<WidgetPreview position="bottom-right" greeting="Need a hand?" />)

    const bubble = () => screen.getByText('Need a hand?').parentElement
    expect(bubble()?.style.display).toBe('none')
    fireEvent.click(launcher())
    expect(bubble()?.style.display).toBe('flex')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(bubble()?.style.display).toBe('none')
  })

  it('opens the panel when the greeting bubble is clicked', () => {
    render(<WidgetPreview position="bottom-right" greeting="Hi there" />)

    fireEvent.click(launcher())
    expect(screen.queryByTitle('Widget preview')).toBeNull()

    fireEvent.click(screen.getByText('Hi there'))
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
    expect(screen.getByText('Hi there').parentElement?.style.display).toBe('none')
  })

  it('places the greeting bubble on the same side as the launcher', () => {
    render(<WidgetPreview position="bottom-left" greeting="Hello" />)

    fireEvent.click(launcher())
    expect(screen.getByText('Hello').parentElement?.style.left).toBe('0px')
  })

  it('does not persist greeting dismiss to the host-page session key', () => {
    render(<WidgetPreview position="bottom-right" greeting="Need a hand?" />)
    fireEvent.click(launcher())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(sessionStorage.getItem('quackback:launcher-greeting-dismissed')).toBeNull()
  })
})
