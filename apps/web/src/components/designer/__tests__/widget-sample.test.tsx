// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * The builder's Widget sample frames the real widget as a preview, in the
 * theme and language the canvas draws, and posts the design into it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'
import { WidgetFrame, widgetSampleSrc, widgetScale } from '../widget-sample'

afterEach(cleanup)

describe('the widget sample', () => {
  it('frames the real widget as a preview, in the theme and language asked for', () => {
    expect(widgetSampleSrc('dark', 'fr')).toBe('/widget?theme=dark&locale=fr&preview=true')
  })

  it('fits the widget in its box, never drawing it larger', () => {
    expect(widgetScale({ width: 1000, height: 1000 })).toBe(1)
    expect(widgetScale({ width: 1000, height: 320 })).toBe(0.5)
    expect(widgetScale({ width: 200, height: 1000 })).toBe(0.5)
  })

  it('posts the design into the widget once it is ready', () => {
    const design = defaultDesign()
    render(<WidgetFrame design={design} theme="light" locale="en" title="Widget" />)
    const frame = screen.getByTitle<HTMLIFrameElement>('Widget')
    expect(frame.getAttribute('src')).toBe('/widget?theme=light&locale=en&preview=true')
    const inside = { postMessage: vi.fn() }
    Object.defineProperty(frame, 'contentWindow', { value: inside })
    const post = inside.postMessage
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:preview-ready' },
          origin: window.location.origin,
          source: inside as unknown as MessageEventSource,
        })
      )
    })
    expect(post).toHaveBeenCalledWith(
      { type: 'quackback:preview-design', design },
      window.location.origin
    )
  })
})
