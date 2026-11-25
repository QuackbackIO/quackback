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

// Each fresh import registers its own message listener; remove them after
// each test so an earlier instance never posts to a later test's parent.
const messageListeners: EventListenerOrEventListenerObject[] = []

function postFromParent(origin: string, source: unknown = window.parent) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'quackback:identify', data: { ssoToken: 't' } },
      origin,
      source: source as MessageEventSource,
    })
  )
}

describe('widget-bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('parent', { postMessage: vi.fn() })
    setEmbedder({ ancestorOrigins: ['https://host.example'] })
    const add = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'message' && listener) messageListeners.push(listener)
      add(type, listener, options)
    })
  })

  afterEach(() => {
    for (const listener of messageListeners.splice(0)) {
      window.removeEventListener('message', listener)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.__quackbackNative = undefined
    setEmbedder({})
  })

  describe('messages without user data', () => {
    it.each([
      [{ type: 'quackback:ready' }],
      [{ type: 'quackback:close' }],
      [{ type: 'quackback:unread', count: 3 }],
      [{ type: 'quackback:expand', expanded: true }],
      [{ type: 'quackback:identify-result', success: true, user: null }],
      [{ type: 'quackback:identify-result', success: false, error: 'NETWORK_ERROR' }],
      [{ type: 'quackback:auth-change', user: null }],
      [{ type: 'quackback:navigate', url: 'https://portal.example/posts/p1' }],
    ])('go to any origin even when the host origin is known: %j', async (message) => {
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(message)
      expect(window.parent.postMessage).toHaveBeenCalledWith(message, '*')
    })

    it('reach the host when the referrer is the frame itself', async () => {
      setEmbedder({ referrer: `${window.location.origin}/widget` })
      const { sendToHost } = await import('../widget-bridge')
      sendToHost({ type: 'quackback:ready' })
      expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'quackback:ready' }, '*')
    })
  })

  describe('messages with user data', () => {
    it('go to the first ancestor origin', async () => {
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://host.example')
    })

    it('fall back to the referrer origin when ancestor origins are unavailable', async () => {
      setEmbedder({ referrer: 'https://app.example/settings?tab=1' })
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://app.example')
    })

    it.each([
      [identifyResult],
      [{ type: 'quackback:auth-change', user: identifyResult.user }],
      [{ type: 'quackback:event', name: 'vote', payload: { postId: 'p1', voted: true } }],
      [{ type: 'quackback:event', name: 'post:created', payload: { id: 'p1', title: 'Hi' } }],
      [{ type: 'quackback:navigate', url: 'https://portal.example/auth/widget-handoff?ott=abc' }],
    ])('are held back while the host origin is unknown: %j', async (message) => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(message)
      expect(window.parent.postMessage).not.toHaveBeenCalled()
    })

    it('are not addressed to the frame itself when the referrer is the frame', async () => {
      setEmbedder({ referrer: `${window.location.origin}/widget?x=1` })
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).not.toHaveBeenCalled()
      postFromParent('https://host.example')
      expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://host.example')
    })
  })

  describe('learning the host origin from its messages', () => {
    it('sends identify results to the parent message origin when the frame sees no ancestors or referrer', async () => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      postFromParent('https://host.example')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenLastCalledWith(
        identifyResult,
        'https://host.example'
      )
    })

    it('flushes user data held back before the first host message, in order', async () => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      const authChange = { type: 'quackback:auth-change', user: identifyResult.user }
      sendToHost(identifyResult)
      sendToHost({ type: 'quackback:ready' })
      sendToHost(authChange)
      expect(vi.mocked(window.parent.postMessage).mock.calls).toEqual([
        [{ type: 'quackback:ready' }, '*'],
      ])

      postFromParent('https://host.example')
      expect(vi.mocked(window.parent.postMessage).mock.calls).toEqual([
        [{ type: 'quackback:ready' }, '*'],
        [identifyResult, 'https://host.example'],
        [authChange, 'https://host.example'],
      ])
    })

    it('prefers the parent message origin over ancestor and referrer origins', async () => {
      setEmbedder({ ancestorOrigins: ['https://stale.example'], referrer: 'https://ref.example/' })
      const { sendToHost } = await import('../widget-bridge')
      postFromParent('https://host.example')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://host.example')
    })

    it('keeps the first parent origin it sees', async () => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      postFromParent('https://host.example')
      postFromParent('https://other.example')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, 'https://host.example')
    })

    it('ignores a message from another window', async () => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      postFromParent('https://other.example', {})
      sendToHost(identifyResult)
      expect(window.parent.postMessage).not.toHaveBeenCalled()
    })

    it('answers identify with a non-personal failure when the host origin is opaque', async () => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(identifyResult)
      postFromParent('null')
      sendToHost({ type: 'quackback:auth-change', user: identifyResult.user })
      sendToHost({ type: 'quackback:event', name: 'vote', payload: { postId: 'p1' } })
      expect(vi.mocked(window.parent.postMessage).mock.calls).toEqual([
        [{ type: 'quackback:identify-result', success: false, error: 'HOST_ORIGIN_UNKNOWN' }, '*'],
      ])

      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenLastCalledWith(
        { type: 'quackback:identify-result', success: false, error: 'HOST_ORIGIN_UNKNOWN' },
        '*'
      )
    })
  })

  describe('the same-origin parent', () => {
    it('receives user data when the referrer is the frame and the parent is readably on that origin', async () => {
      const own = window.location.origin
      setEmbedder({ referrer: `${own}/admin/settings/widget` })
      vi.stubGlobal('parent', { postMessage: vi.fn(), location: { origin: own } })
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).toHaveBeenCalledWith(identifyResult, own)
    })

    it('holds user data back when the parent cannot be read', async () => {
      setEmbedder({ referrer: `${window.location.origin}/widget` })
      vi.stubGlobal('parent', {
        postMessage: vi.fn(),
        get location(): never {
          throw new DOMException('Blocked a frame', 'SecurityError')
        },
      })
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(identifyResult)
      expect(window.parent.postMessage).not.toHaveBeenCalled()
    })
  })

  describe('the portal handoff link', () => {
    const handoff = {
      type: 'quackback:navigate',
      url: 'https://portal.example/auth/widget-handoff?ott=abc',
    }

    it('is never held for later', async () => {
      setEmbedder({})
      const { sendToHost } = await import('../widget-bridge')
      sendToHost(handoff)
      postFromParent('https://host.example')
      expect(window.parent.postMessage).not.toHaveBeenCalled()
    })

    it('reports whether user data can reach the host now', async () => {
      setEmbedder({})
      const { canDeliverUserData } = await import('../widget-bridge')
      expect(canDeliverUserData()).toBe(false)
      postFromParent('https://host.example')
      expect(canDeliverUserData()).toBe(true)
    })

    it('reports that an opaque host can never receive it', async () => {
      setEmbedder({ ancestorOrigins: ['https://host.example'] })
      const { canDeliverUserData } = await import('../widget-bridge')
      postFromParent('null')
      expect(canDeliverUserData()).toBe(false)
    })

    it('reports the native bridge as always reachable', async () => {
      setEmbedder({})
      window.__quackbackNative = { dispatch: vi.fn() }
      const { canDeliverUserData } = await import('../widget-bridge')
      expect(canDeliverUserData()).toBe(true)
    })
  })

  describe('a full queue of held-back user data', () => {
    const event = (n: number) => ({
      type: 'quackback:event',
      name: 'vote',
      payload: { postId: `p${n}` },
    })
    const identify = (id: string) => ({
      type: 'quackback:identify-result',
      success: true,
      user: { id },
    })

    async function fill() {
      setEmbedder({})
      const bridge = await import('../widget-bridge')
      bridge.sendToHost(identify('u_old'))
      for (let n = 1; n < bridge.MAX_PENDING_USER_MESSAGES; n++) bridge.sendToHost(event(n))
      return bridge
    }

    function flushed() {
      postFromParent('https://host.example')
      return vi.mocked(window.parent.postMessage).mock.calls.map(([message]) => message)
    }

    it('replaces the older identify result with the latest one', async () => {
      const { sendToHost, MAX_PENDING_USER_MESSAGES } = await fill()
      sendToHost(identify('u_new'))
      const sent = flushed()
      expect(sent).toHaveLength(MAX_PENDING_USER_MESSAGES)
      expect(sent).not.toContainEqual(identify('u_old'))
      expect(sent.at(-1)).toEqual(identify('u_new'))
    })

    it('drops the oldest event to keep a new auth change', async () => {
      const { sendToHost, MAX_PENDING_USER_MESSAGES } = await fill()
      const authChange = { type: 'quackback:auth-change', user: { id: 'u_new' } }
      sendToHost(authChange)
      const sent = flushed()
      expect(sent).toHaveLength(MAX_PENDING_USER_MESSAGES)
      expect(sent[0]).toEqual(identify('u_old'))
      expect(sent).not.toContainEqual(event(1))
      expect(sent.at(-1)).toEqual(authChange)
    })

    it('drops the oldest event to keep a new one', async () => {
      const { sendToHost, MAX_PENDING_USER_MESSAGES } = await fill()
      sendToHost(event(99))
      const sent = flushed()
      expect(sent).toHaveLength(MAX_PENDING_USER_MESSAGES)
      expect(sent).not.toContainEqual(event(1))
      expect(sent).toContainEqual(event(2))
      expect(sent.at(-1)).toEqual(event(99))
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
    [{ referrer: 'https://widget.example/widget', ownOrigin: 'https://widget.example' }],
    [
      {
        referrer: 'https://widget.example/widget',
        ownOrigin: 'https://widget.example',
        parentOrigin: 'https://other.example',
      },
    ],
    [{}],
  ])('returns null for %j', async (source) => {
    const { resolveHostOrigin } = await import('../widget-bridge')
    expect(resolveHostOrigin(source)).toBeNull()
  })

  it('trusts a referrer on its own origin when the readable parent is on it too', async () => {
    const { resolveHostOrigin } = await import('../widget-bridge')
    expect(
      resolveHostOrigin({
        referrer: 'https://widget.example/admin/settings',
        ownOrigin: 'https://widget.example',
        parentOrigin: 'https://widget.example',
      })
    ).toBe('https://widget.example')
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
