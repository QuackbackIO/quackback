// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The bridge reads the host origin once per module instance; each test sets
// the frame's view of its embedder and imports a fresh copy.
function setEmbedder({
  ancestorOrigins,
  referrer,
}: {
  ancestorOrigins?: string[]
  referrer?: string
}) {
  Object.defineProperty(window.location, 'ancestorOrigins', {
    value: ancestorOrigins,
    configurable: true,
  })
  Object.defineProperty(document, 'referrer', { value: referrer ?? '', configurable: true })
}

const identifyResult = {
  type: 'quackback:identify-result',
  success: true,
  user: { id: 'u1', name: 'Test', email: 'test@example.com' },
}

describe('widget-bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('parent', { postMessage: vi.fn() })
    setEmbedder({ ancestorOrigins: ['https://host.example'] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.__quackbackNative = undefined
    setEmbedder({})
  })

  it('sends via postMessage to the host origin in iframe mode', async () => {
    const { sendToHost } = await import('../widget-bridge')
    sendToHost({ type: 'quackback:ready' })
    expect(window.parent.postMessage).toHaveBeenCalledWith(
      { type: 'quackback:ready' },
      'https://host.example'
    )
  })

  it('falls back to the referrer origin when ancestor origins are unavailable', async () => {
    setEmbedder({ referrer: 'https://app.example/settings?tab=1' })
    const { sendToHost } = await import('../widget-bridge')
    sendToHost(identifyResult)
    expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://app.example')
  })

  describe('when the host origin is unknown', () => {
    beforeEach(() => setEmbedder({}))

    it.each([
      [{ type: 'quackback:ready' }],
      [{ type: 'quackback:close' }],
      [{ type: 'quackback:unread', count: 3 }],
      [{ type: 'quackback:expand', expanded: true }],
      [{ type: 'quackback:identify-result', success: true, user: null }],
      [{ type: 'quackback:identify-result', success: false, error: 'NETWORK_ERROR' }],
      [{ type: 'quackback:auth-change', user: null }],
      [{ type: 'quackback:event', name: 'vote', payload: { postId: 'p1', voted: true } }],
      [{ type: 'quackback:navigate', url: 'https://portal.example/posts/p1' }],
    ])('still sends %j to any origin', async (message) => {
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(message)
      expect(window.parent.postMessage).toHaveBeenCalledWith(message, '*')
    })

    it.each([
      [identifyResult],
      [{ type: 'quackback:auth-change', user: identifyResult.user }],
      [
        {
          type: 'quackback:event',
          name: 'identify',
          payload: { success: true, user: identifyResult.user, anonymous: false },
        },
      ],
      [{ type: 'quackback:navigate', url: 'https://portal.example/auth/widget-handoff?ott=abc' }],
    ])('does not send %j, which names the user', async (message) => {
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(message)
      expect(window.parent.postMessage).not.toHaveBeenCalled()
    })
  })

  it('still dispatches user data through the native bridge', async () => {
    setEmbedder({})
    const dispatch = vi.fn()
    window.__quackbackNative = { dispatch }
    const { sendToHost } = await import('../widget-bridge')
    sendToHost(identifyResult)
    expect(dispatch).toHaveBeenCalledWith('identify-result', identifyResult)
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
    expect(window.parent.postMessage).toHaveBeenCalledWith(
      { type: 'quackback:close' },
      'https://host.example'
    )
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
    sendToHost(identifyResult)
    expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://host.example')
  })
})

describe('resolveHostOrigin', () => {
  it('prefers the first ancestor origin', async () => {
    const { resolveHostOrigin } = await import('../widget-bridge')
    expect(
      resolveHostOrigin({
        ancestorOrigins: ['https://parent.example', 'https://top.example'],
        referrer: 'https://other.example/page',
      })
    ).toBe('https://parent.example')
  })

  it('uses the referrer origin when ancestor origins are missing or empty', async () => {
    const { resolveHostOrigin } = await import('../widget-bridge')
    expect(resolveHostOrigin({ referrer: 'https://app.example/a/b?c=1#d' })).toBe(
      'https://app.example'
    )
    expect(resolveHostOrigin({ ancestorOrigins: [], referrer: 'http://localhost:3000/' })).toBe(
      'http://localhost:3000'
    )
  })

  it.each([
    [{ ancestorOrigins: ['null'], referrer: 'https://app.example/' }],
    [{ referrer: '' }],
    [{ referrer: 'not a url' }],
    [{ referrer: 'file:///tmp/page.html' }],
    [{}],
  ])('returns null for %j', async (source) => {
    const { resolveHostOrigin } = await import('../widget-bridge')
    expect(resolveHostOrigin(source)).toBeNull()
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
