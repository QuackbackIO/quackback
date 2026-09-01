// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * <WidgetPreview> — admin widget settings live preview.
 *
 * The preview embeds the real `/widget` app in an iframe and simulates only
 * the host chrome the SDK provides on a customer page:
 *   - The iframe targets /widget with the selected theme forced via ?theme=.
 *   - The launcher button toggles the panel open/closed.
 *   - Panel and launcher share a bottom corner (panel above, button below).
 *   - An optional greeting bubble sits above the closed launcher.
 *   - The widget's own close button messages its host (quackback:close);
 *     the preview honours it like the SDK would, but only from its own origin.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WidgetPreview } from '../widget-preview'

function sendClose(origin: string) {
  fireEvent(window, new MessageEvent('message', { data: { type: 'quackback:close' }, origin }))
}

describe('WidgetPreview', () => {
  it('embeds the real widget with the selected theme forced', () => {
    render(<WidgetPreview position="bottom-right" theme="dark" />)

    const iframe = screen.getByTitle<HTMLIFrameElement>('Widget preview')
    expect(iframe.getAttribute('src')).toBe('/widget?theme=dark')
  })

  it('toggles the panel via the launcher button', () => {
    render(<WidgetPreview position="bottom-right" />)

    const launcher = screen.getByRole('button', { name: /feedback widget/i })
    fireEvent.click(launcher)
    expect(screen.queryByTitle('Widget preview')).toBeNull()

    fireEvent.click(launcher)
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

    expect(screen.getByRole('button', { name: /feedback widget/i }).className).toContain('left-0')
  })

  it('stacks the open panel above the launcher in the same corner', () => {
    render(<WidgetPreview position="bottom-right" />)

    const panel = screen.getByTitle('Widget preview').parentElement
    const launcher = screen.getByRole('button', { name: /feedback widget/i })
    expect(panel?.className).toContain('bottom-[88px]')
    expect(launcher.className).toContain('bottom-0')
    expect(launcher.className).toContain('right-0')
    expect(panel?.parentElement?.className).toContain('w-[400px]')
    expect(panel?.parentElement?.parentElement?.className).toContain('items-center')
    expect(panel?.parentElement?.parentElement?.className).toContain('justify-center')
  })

  it('shows the launcher greeting bubble while the panel is closed', () => {
    render(<WidgetPreview position="bottom-right" greeting="Need a hand?" />)

    expect(screen.queryByText('Need a hand?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /feedback widget/i }))
    expect(screen.getByText('Need a hand?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss greeting' }))
    expect(screen.queryByText('Need a hand?')).toBeNull()
  })

  it('opens the panel when the greeting bubble is clicked', () => {
    render(<WidgetPreview position="bottom-right" greeting="Hi there" />)

    fireEvent.click(screen.getByRole('button', { name: /feedback widget/i }))
    expect(screen.queryByTitle('Widget preview')).toBeNull()

    fireEvent.click(screen.getByText('Hi there'))
    expect(screen.getByTitle('Widget preview')).toBeTruthy()
    expect(screen.queryByText('Hi there')).toBeNull()
  })

  it('places the greeting bubble on the same side as the launcher', () => {
    render(<WidgetPreview position="bottom-left" greeting="Hello" />)

    fireEvent.click(screen.getByRole('button', { name: /feedback widget/i }))
    expect(screen.getByText('Hello').parentElement?.className).toContain('left-0')
  })
})
