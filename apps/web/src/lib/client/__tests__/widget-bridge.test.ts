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
})
