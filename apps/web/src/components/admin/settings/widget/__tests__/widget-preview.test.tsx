// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * <WidgetPreview> — admin widget settings live preview.
 *
 * The preview embeds the real `/widget` app in an iframe and simulates only
 * the host chrome the SDK provides on a customer page:
 *   - The iframe targets /widget with the selected theme forced via ?theme=.
 *   - The launcher button toggles the panel open/closed.
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

    const launcher = screen.getByRole('button')
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

    expect(screen.getByRole('button').className).toContain('left-4')
  })
})
