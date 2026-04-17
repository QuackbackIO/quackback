import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSDK } from '../src/core/sdk'

const ORIGIN = 'https://feedback.acme.com'

function stubIframe() {
  const postMessage = vi.fn()
  const spy = vi
    .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
    .mockReturnValue({ postMessage } as unknown as Window)
  return { postMessage, spy }
}

function fireReady() {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ORIGIN,
      data: { type: 'quackback:ready' },
    })
  )
}

describe('sdk', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) }))
    )
  })
  afterEach(() => vi.restoreAllMocks())

  it('init creates a launcher and iframe', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).not.toBeNull()
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
  })

  it('init with { launcher: false } does not create a button', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).toBeNull()
  })

  it('init defaults identity to anonymous once iframe is ready', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:identify', data: { anonymous: true } },
      ORIGIN
    )
    spy.mockRestore()
  })

  it('init with bundled identity sends it to iframe', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', {
      instanceUrl: ORIGIN,
      identity: { id: 'u1', email: 'a@b.c', name: 'Ada' },
    })
    fireReady()
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:identify', data: { id: 'u1', email: 'a@b.c', name: 'Ada' } },
      ORIGIN
    )
    spy.mockRestore()
  })

  it('identify sends the payload after ready', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    sdk.dispatch('identify', { id: 'u2', email: 'b@c.d' })
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'quackback:identify', data: { id: 'u2', email: 'b@c.d' } },
      ORIGIN
    )
    spy.mockRestore()
  })

  it('logout sends null identify and keeps the launcher visible', () => {
    const { spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    sdk.dispatch('logout')
    const launcher = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(launcher).not.toBeNull()
    expect(launcher.style.display).not.toBe('none')
    spy.mockRestore()
  })

  it('isOpen tracks panel state', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(sdk.isOpen()).toBe(false)
    sdk.dispatch('open')
    expect(sdk.isOpen()).toBe(true)
    sdk.dispatch('close')
    expect(sdk.isOpen()).toBe(false)
  })

  it('getUser / isIdentified reflect identify-result messages', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(sdk.getUser()).toBeNull()
    expect(sdk.isIdentified()).toBe(false)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: {
          type: 'quackback:identify-result',
          success: true,
          user: { id: 'u1', name: 'Ada', email: 'a@b.c' },
        },
      })
    )
    expect(sdk.getUser()).toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    expect(sdk.isIdentified()).toBe(true)
    sdk.dispatch('logout')
    expect(sdk.getUser()).toBeNull()
    expect(sdk.isIdentified()).toBe(false)
  })

  it('open emits an open event with view context', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const seen: unknown[] = []
    sdk.dispatch('on', 'open', (payload: unknown) => seen.push(payload))
    sdk.dispatch('open', { view: 'new-post', title: 'Bug:' })
    expect(seen).toHaveLength(1)
    expect((seen[0] as { view: string }).view).toBe('new-post')
  })

  it('open passes deep-link fields to the iframe', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    sdk.dispatch('open', { postId: 'post_01h' })
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:open', data: { postId: 'post_01h' } },
      ORIGIN
    )
    spy.mockRestore()
  })

  it('metadata merges and sends to iframe', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    sdk.dispatch('metadata', { page: '/settings', app_version: '2.4.1' })
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'quackback:metadata',
        data: { page: '/settings', app_version: '2.4.1' },
      },
      ORIGIN
    )
    sdk.dispatch('metadata', { page: null })
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'quackback:metadata', data: { app_version: '2.4.1' } },
      ORIGIN
    )
    spy.mockRestore()
  })

  it('hideLauncher hides the button; showLauncher shows it again', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const launcher = () =>
      document.querySelector(
        'button[aria-label="Open feedback widget"]'
      ) as HTMLButtonElement | null
    sdk.dispatch('hideLauncher')
    expect(launcher()?.style.display).toBe('none')
    sdk.dispatch('showLauncher')
    expect(launcher()?.style.display).toBe('flex')
  })

  it('destroy removes the iframe and launcher', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('iframe[title="Feedback Widget"]')).not.toBeNull()
    sdk.dispatch('destroy')
    expect(document.querySelector('iframe[title="Feedback Widget"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).toBeNull()
  })
})
