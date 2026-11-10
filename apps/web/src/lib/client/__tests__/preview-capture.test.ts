// @vitest-environment happy-dom
/**
 * The critic's picture is the frame's page drawn through an SVG, which is a
 * still at its first moment: a list that fades in would be drawn invisible,
 * so the picture holds animations and transitions at their end.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePreview } from '../preview-capture'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('capturePreview', () => {
  it('draws the page with its fade-in animations held at their end', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const doc = frame.contentDocument!
    doc.body.innerHTML =
      '<ul><li class="animate-in fade-in fill-mode-backwards" style="animation-delay: 30ms">A post</li></ul>'
    let drawn = ''
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function (
      this: HTMLImageElement
    ) {
      drawn = decodeURIComponent(this.src)
      return Promise.reject(new Error('stop here'))
    })
    expect(await capturePreview(frame)).toBeNull()
    expect(drawn).toContain('A post')
    expect(drawn).toMatch(
      /\*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/
    )
  })
})
