// @vitest-environment happy-dom
/**
 * On a phone the on-screen keyboard shrinks the visual viewport but not the
 * layout viewport, so a full-screen panel sized by CSS runs under the
 * keyboard. The panel follows window.visualViewport while it is open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fitToVisualViewport } from '../src/core/viewport'

function fakeViewport(height: number, offsetTop = 0) {
  return Object.assign(new EventTarget(), { height, offsetTop })
}

function fakeQuery(matches: boolean) {
  return Object.assign(new EventTarget(), { matches }) as unknown as MediaQueryList & {
    matches: boolean
  }
}

describe('fitToVisualViewport', () => {
  let frames: Array<() => void> = []
  const runFrames = () => {
    const due = frames
    frames = []
    for (const cb of due) cb()
  }
  let el: HTMLElement

  beforeEach(() => {
    frames = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: () => void) => frames.push(cb))
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        frames[id - 1] = () => {}
      })
    )
    el = document.createElement('div')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sizes the element to the visible viewport straight away', () => {
    vi.stubGlobal('visualViewport', fakeViewport(420, 0))
    fitToVisualViewport(el, fakeQuery(true))
    expect(el.style.height).toBe('420px')
    expect(el.style.top).toBe('0px')
  })

  it('follows the keyboard, once per frame', () => {
    const viewport = fakeViewport(700)
    vi.stubGlobal('visualViewport', viewport)
    fitToVisualViewport(el, fakeQuery(true))
    viewport.height = 380
    viewport.offsetTop = 40
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    expect(frames).toHaveLength(1)
    expect(el.style.height).toBe('700px')
    runFrames()
    expect(el.style.height).toBe('380px')
    expect(el.style.top).toBe('40px')
  })

  it('restores the stylesheet values on detach and stops listening', () => {
    const viewport = fakeViewport(380, 40)
    vi.stubGlobal('visualViewport', viewport)
    const detach = fitToVisualViewport(el, fakeQuery(true))
    viewport.dispatchEvent(new Event('resize'))
    detach()
    expect(el.style.height).toBe('')
    expect(el.style.top).toBe('')
    // A frame queued before detach does nothing when it runs.
    runFrames()
    expect(el.style.height).toBe('')
    viewport.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(0)
  })

  it('leaves the stylesheet alone off a phone, and lets go when the phone rule stops matching', () => {
    vi.stubGlobal('visualViewport', fakeViewport(380))
    const query = fakeQuery(false)
    fitToVisualViewport(el, query)
    expect(el.style.height).toBe('')
    query.matches = true
    query.dispatchEvent(new Event('change'))
    runFrames()
    expect(el.style.height).toBe('380px')
    query.matches = false
    query.dispatchEvent(new Event('change'))
    runFrames()
    expect(el.style.height).toBe('')
    expect(el.style.top).toBe('')
  })

  it('does nothing without visualViewport', () => {
    vi.stubGlobal('visualViewport', undefined)
    const detach = fitToVisualViewport(el, fakeQuery(true))
    expect(el.style.height).toBe('')
    detach()
    expect(el.style.height).toBe('')
  })
})
