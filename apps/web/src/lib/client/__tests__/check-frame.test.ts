// @vitest-environment happy-dom
/**
 * The check reads the page a brand match changes (Home) at the screenshots'
 * width, in a frame of its own off screen, so the builder's canvas stays on
 * the page someone is looking at: the frame is laid out 1440px wide, gets
 * the design once the portal says it is ready (and again after a reload),
 * every later design too, and waits for the page's data to draw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECK_VIEWPORT, contentDrawn, openCheckFrame } from '../check-frame'

afterEach(() => {
  document.body.innerHTML = ''
})

/** The portal in the frame saying it is ready, as portal-preview-listener does. */
function ready(frame: HTMLIFrameElement) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'quackback:preview-ready', path: '/' },
      origin: window.location.origin,
      source: frame.contentWindow,
    })
  )
}

describe('openCheckFrame', () => {
  it('lays out Home off screen at the screenshots’ width and sends it each design', async () => {
    const opening = openCheckFrame({
      src: 'about:blank',
      design: { name: 'first' },
      settle: async () => {},
    })
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-brand-check]')!
    expect(frame).toBeTruthy()
    expect(frame.getAttribute('src')).toBe('about:blank')
    expect(frame.style.width).toBe(`${CHECK_VIEWPORT.width}px`)
    expect(frame.style.height).toBe(`${CHECK_VIEWPORT.height}px`)
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.tabIndex).toBe(-1)
    const posted: unknown[] = []
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((m: unknown) => {
      posted.push(m)
    })
    ready(frame)
    const probe = await opening
    expect(posted).toEqual([{ type: 'quackback:preview-design', design: { name: 'first' } }])
    expect(probe.frame()).toBe(frame)
    probe.show({ name: 'second' })
    expect(posted.at(-1)).toEqual({ type: 'quackback:preview-design', design: { name: 'second' } })
    // A reload starts from the saved design: the latest is sent again.
    ready(frame)
    expect(posted.at(-1)).toEqual({ type: 'quackback:preview-design', design: { name: 'second' } })
    probe.close()
    expect(document.querySelector('iframe[data-brand-check]')).toBeNull()
  })

  it('gives up, removing its frame, when the portal never says it is ready', async () => {
    await expect(
      openCheckFrame({
        src: 'about:blank',
        design: {},
        timeoutMs: 20,
        settle: async () => {},
      })
    ).rejects.toThrow(/ready/)
    expect(document.querySelector('iframe[data-brand-check]')).toBeNull()
  })
})

describe('contentDrawn', () => {
  it('waits while the page still shows skeletons or busy regions', () => {
    document.body.innerHTML = '<main><div data-slot="skeleton"></div></main>'
    expect(contentDrawn(document)).toBe(false)
    document.body.innerHTML = '<main><ul aria-busy="true"></ul></main>'
    expect(contentDrawn(document)).toBe(false)
    document.body.innerHTML = '<main><div class="animate-pulse"></div></main>'
    expect(contentDrawn(document)).toBe(false)
    document.body.innerHTML = '<main><article>Post</article></main>'
    expect(contentDrawn(document)).toBe(true)
  })
})
