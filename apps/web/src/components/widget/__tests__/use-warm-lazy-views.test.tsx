// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useWarmLazyViews } from '../use-warm-lazy-views'

const hostFrame = { postMessage: () => {} } as unknown as Window

function embedIn(parent: Window) {
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
}

function loaders() {
  return [vi.fn(() => Promise.resolve()), vi.fn(() => Promise.resolve())]
}

function fromHost(type: string, source: Window = hostFrame) {
  window.dispatchEvent(new MessageEvent('message', { data: { type }, source }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => window.setTimeout(cb, 50))
  vi.stubGlobal('cancelIdleCallback', (id: number) => window.clearTimeout(id))
})

afterEach(() => {
  cleanup()
  embedIn(window)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useWarmLazyViews', () => {
  it('warms every view at idle in a top-level document', () => {
    const views = loaders()
    renderHook(() => useWarmLazyViews(views))
    vi.advanceTimersByTime(5000)
    for (const load of views) expect(load).toHaveBeenCalledTimes(1)
  })

  it('in a host page frame, waits for the host to open the widget', () => {
    embedIn(hostFrame)
    const views = loaders()
    renderHook(() => useWarmLazyViews(views))
    vi.advanceTimersByTime(60_000)
    for (const load of views) expect(load).not.toHaveBeenCalled()

    fromHost('quackback:open')
    vi.advanceTimersByTime(5000)
    for (const load of views) expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores other messages and messages from other frames', () => {
    embedIn(hostFrame)
    const views = loaders()
    renderHook(() => useWarmLazyViews(views))
    fromHost('quackback:identify')
    fromHost('quackback:open', window)
    vi.advanceTimersByTime(60_000)
    for (const load of views) expect(load).not.toHaveBeenCalled()
  })

  it('in a frame shown without the SDK, warms on the first interaction', () => {
    embedIn(hostFrame)
    const views = loaders()
    renderHook(() => useWarmLazyViews(views))
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(5000)
    for (const load of views) expect(load).toHaveBeenCalledTimes(1)
  })

  it('warms once however often the widget is opened', () => {
    embedIn(hostFrame)
    const views = loaders()
    renderHook(() => useWarmLazyViews(views))
    fromHost('quackback:open')
    vi.advanceTimersByTime(5000)
    fromHost('quackback:open')
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(5000)
    for (const load of views) expect(load).toHaveBeenCalledTimes(1)
  })

  it('never warms after unmounting', () => {
    embedIn(hostFrame)
    const views = loaders()
    const { unmount } = renderHook(() => useWarmLazyViews(views))
    fromHost('quackback:open')
    unmount()
    vi.advanceTimersByTime(5000)
    for (const load of views) expect(load).not.toHaveBeenCalled()
  })
})
