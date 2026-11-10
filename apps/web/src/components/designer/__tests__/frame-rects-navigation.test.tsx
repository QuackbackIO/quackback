// @vitest-environment happy-dom
/**
 * The canvas watches the page in its frame with the frame's own observers.
 * When Preview follows a link the frame holds a new page, and the old page's
 * observers cannot watch it: they must be made afresh, never handed the new
 * page's elements (the browser throws "parameter 1 is not of type 'Element'").
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFrameRects } from '../use-frame-rects'

type Callback = () => void

/** A page in the frame, with observers that, like the browser's, only take its own elements. */
function page() {
  const doc = document.implementation.createHTMLDocument('page')
  doc.body.innerHTML = '<div data-qb-section="feed"></div>'
  const mutations: Callback[] = []
  class OwnResizeObserver {
    observe(element: Element) {
      if (element.ownerDocument !== doc)
        throw new TypeError(
          "Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'."
        )
    }
    unobserve() {}
    disconnect() {}
  }
  class OwnMutationObserver {
    constructor(callback: Callback) {
      mutations.push(callback)
    }
    observe() {}
    disconnect() {}
  }
  const win = {
    ResizeObserver: OwnResizeObserver,
    MutationObserver: OwnMutationObserver,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return { doc, win, changed: () => mutations.forEach((callback) => callback()) }
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    // Ran at once, so nothing is left pending.
    return 0
  })
})
afterEach(() => vi.restoreAllMocks())

describe('the canvas after the frame loads a new page', () => {
  it('watches the new page with its own observers instead of the old page’s', () => {
    const first = page()
    const frame = {
      contentDocument: first.doc,
      contentWindow: first.win,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLIFrameElement
    const { result } = renderHook(() => useFrameRects(frame, 1, ['feed']))
    expect(result.current.feed).toBeDefined()

    // Preview follows a link: the frame holds the next page before its load event.
    const next = page()
    Object.assign(frame, { contentDocument: next.doc, contentWindow: next.win })
    expect(() => act(() => first.changed())).not.toThrow()
    expect(result.current.feed).toBeDefined()
  })
})
