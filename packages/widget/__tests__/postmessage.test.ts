// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBridge } from '../src/core/postmessage'

describe('postmessage bridge', () => {
  let postMessage: ReturnType<typeof vi.fn>
  let fakeIframe: { contentWindow: { postMessage: typeof postMessage } }

  beforeEach(() => {
    postMessage = vi.fn()
    fakeIframe = { contentWindow: { postMessage } }
  })

  afterEach(() => vi.restoreAllMocks())

  it('send posts a typed message to the iframe origin', () => {
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.send('quackback:identify', { anonymous: true })
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:identify', data: { anonymous: true } },
      'https://feedback.acme.com'
    )
  })

  it('ignores events from other origins', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'quackback:ready' },
      })
    )
    expect(onRecv).not.toHaveBeenCalled()
  })

  it('forwards valid messages from the iframe origin', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: { type: 'quackback:ready' },
      })
    )
    expect(onRecv).toHaveBeenCalledWith({ type: 'quackback:ready' })
  })

  it('ignores non-object data', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: 'hello',
      })
    )
    expect(onRecv).not.toHaveBeenCalled()
  })

  it('dispose removes the window listener', () => {
    const onRecv = vi.fn()
    const bridge = createBridge({
      getIframe: () => fakeIframe as unknown as HTMLIFrameElement,
      origin: 'https://feedback.acme.com',
    })
    bridge.onMessage(onRecv)
    bridge.dispose()
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://feedback.acme.com',
        data: { type: 'quackback:ready' },
      })
    )
    expect(onRecv).not.toHaveBeenCalled()
  })
})
