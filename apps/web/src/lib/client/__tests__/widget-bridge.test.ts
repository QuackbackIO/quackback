// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('widget-bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('parent', { postMessage: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.__quackbackNative = undefined
  })

  it('sends via postMessage in iframe mode', async () => {
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:ready' })
    expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'quackback:ready' }, '*')
  })

  it('sends via native dispatch when bridge exists', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }

    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:event', name: 'vote', payload: { postId: 'post_abc' } })

    expect(dispatch).toHaveBeenCalledWith('event', {
      type: 'quackback:event',
      name: 'vote',
      payload: { postId: 'post_abc' },
    })
    expect(window.parent.postMessage).not.toHaveBeenCalled()
  })

  it('falls back to postMessage when native dispatch is missing', async () => {
    window.__quackbackNative = {}
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:close' })
    expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'quackback:close' }, '*')
  })

  it('strips quackback: prefix for native event type', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:close' })
    expect(dispatch).toHaveBeenCalledWith(
      'close',
      expect.objectContaining({ type: 'quackback:close' })
    )
  })

  it('passes non-prefixed type through to native dispatch', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'custom-event' })
    expect(dispatch).toHaveBeenCalledWith(
      'custom-event',
      expect.objectContaining({ type: 'custom-event' })
    )
  })

  it('uses "unknown" when message has no type field', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ data: 'no type here' })
    expect(dispatch).toHaveBeenCalledWith(
      'unknown',
      expect.objectContaining({ data: 'no type here' })
    )
  })

  it('handles type field that is not a string', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 123 as unknown as string })
    expect(dispatch).toHaveBeenCalledWith('unknown', expect.anything())
  })

  it('passes full message object to native dispatch unchanged', async () => {
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }
    const { sendToHost } = await import('../widget-bridge')
    const msg = {
      type: 'quackback:event',
      name: 'vote',
      payload: { postId: 'p1', voted: true, voteCount: 5 },
    }
    sendToHost(msg)
    expect(dispatch.mock.calls[0][1]).toEqual(msg)
  })

  it('passes full message object to postMessage unchanged', async () => {
    const { sendToHost } = await import('../widget-bridge')
    const msg = {
      type: 'quackback:identify-result',
      success: true,
      user: { id: 'u1', name: 'Test' },
    }
    sendToHost(msg)
    expect(window.parent.postMessage).toHaveBeenCalledWith(msg, '*')
  })
})

describe('isNativeWidget', () => {
  it('returns true when source=native is in URL', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?source=native&platform=ios' },
      writable: true,
      configurable: true,
    })
    const { isNativeWidget } = await import('../widget-bridge')
    expect(isNativeWidget()).toBe(true)
  })

  it('returns false when source param is missing', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
      configurable: true,
    })
    const { isNativeWidget } = await import('../widget-bridge')
    expect(isNativeWidget()).toBe(false)
  })

  it('returns false when source is not native', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?source=iframe' },
      writable: true,
      configurable: true,
    })
    const { isNativeWidget } = await import('../widget-bridge')
    expect(isNativeWidget()).toBe(false)
  })

  it('returns true regardless of other params', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?locale=fr&source=native&other=1' },
      writable: true,
      configurable: true,
    })
    const { isNativeWidget } = await import('../widget-bridge')
    expect(isNativeWidget()).toBe(true)
  })
})
