// @vitest-environment happy-dom
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

// The last open command and the origin it was sent to.
function lastOpen(postMessage: ReturnType<typeof vi.fn>) {
  return postMessage.mock.calls
    .filter(([msg]) => (msg as { type: string }).type === 'quackback:open')
    .at(-1)
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
    // The panel preloads in an idle slot; flush it synchronously so tests can
    // keep asserting the iframe right after init. Deferral itself is covered
    // by its own test below.
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: () => void) => {
        cb()
        return 1
      })
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__
  })

  it('init creates a launcher and iframe', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).not.toBeNull()
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
  })

  it('init with { launcher: false } does not create a button', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).toBeNull()
  })

  it('a repeat init re-applies launcher: false', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).not.toBeNull()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).toBeNull()
  })

  it('a repeat init moves an existing launcher to the new placement', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    sdk.dispatch('init', { instanceUrl: ORIGIN, placement: 'left' })
    const btn = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(btn.style.left).toBe('calc(24px + env(safe-area-inset-left, 0px))')
    expect(btn.style.right).toBe('')
  })

  it('a repeat init that throws leaves the existing instance intact', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(() => sdk.dispatch('init', { instanceUrl: 'not a url' })).toThrow()
    // The good first instance is untouched.
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
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

  it('keeps the closed panel out of the tab order and names the frame', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const iframe = document.querySelector('iframe.quackback-widget-iframe') as HTMLIFrameElement
    const panel = iframe.parentElement as HTMLElement
    expect(iframe.title).toBe('Help')
    expect(panel.inert).toBe(true)
    sdk.dispatch('open')
    expect(panel.inert).toBe(false)
    sdk.dispatch('close')
    expect(panel.inert).toBe(true)
  })

  it('names the frame in the visitor language', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, locale: 'de' })
    expect(
      (document.querySelector('iframe.quackback-widget-iframe') as HTMLIFrameElement).title
    ).toBe('Hilfe')
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
    sdk.dispatch('open', {
      view: 'new-post',
      title: 'Bug:',
      body: 'steps',
      board: 'bug-reports',
    })
    expect(lastOpen(postMessage)).toEqual([
      {
        type: 'quackback:open',
        data: { view: 'new-post', title: 'Bug:', body: 'steps', board: 'bug-reports' },
      },
      ORIGIN,
    ])
    spy.mockRestore()
  })

  it('open forwards the messages and tickets views to the iframe', () => {
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    fireReady()
    sdk.dispatch('open', { view: 'messages' })
    expect(lastOpen(postMessage)).toEqual([
      { type: 'quackback:open', data: { view: 'messages' } },
      ORIGIN,
    ])
    sdk.dispatch('open', { view: 'tickets' })
    expect(lastOpen(postMessage)).toEqual([
      { type: 'quackback:open', data: { view: 'tickets' } },
      ORIGIN,
    ])
    spy.mockRestore()
  })

  it('open event carries the messages and tickets views', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const seen: Array<{ view?: string }> = []
    sdk.dispatch('on', 'open', (payload: { view?: string }) => seen.push(payload))
    sdk.dispatch('open', { view: 'messages' })
    sdk.dispatch('open', { view: 'tickets' })
    expect(seen.map((payload) => payload.view)).toEqual(['messages', 'tickets'])
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

  it('launcher starts hidden and reveals as soon as the config fetch resolves', async () => {
    stubIframe()
    let resolveFetch!: (value: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          })
      )
    )
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const btn = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(btn.style.opacity).toBe('0')
    resolveFetch({ ok: true, json: async () => ({ theme: {} }) })
    // Let the fetch → json → applyServerConfig → finally chain settle. Colors
    // are applied before the reveal, so there is no flash to wait out.
    await new Promise((r) => setTimeout(r, 0))
    expect(btn.style.opacity).toBe('1')
  })

  it('baked __QUACKBACK_CONFIG__ reveals the launcher instantly without a config fetch', () => {
    stubIframe()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    window.__QUACKBACK_CONFIG__ = {
      theme: { lightPrimary: '#ff0000', lightPrimaryForeground: '#ffffff', themeMode: 'light' },
      launcherGreeting: 'Hi there!',
    }
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const btn = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(btn.style.opacity).toBe('1')
    expect(btn.style.backgroundColor).toBe('#ff0000')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('panel creation waits for the idle slot; open() forces it immediately', () => {
    stubIframe()
    // Capture the idle callback instead of flushing it synchronously.
    let idleCb: (() => void) | null = null
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: () => void) => {
        idleCb = cb
        return 1
      })
    )
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('iframe.quackback-widget-iframe')).toBeNull()
    sdk.dispatch('open')
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
    // The idle slot firing later must not create a second panel.
    idleCb?.()
    expect(document.querySelectorAll('iframe.quackback-widget-iframe')).toHaveLength(1)
  })

  it('launcher reveals via fallback timer if config fetch never resolves', async () => {
    vi.useFakeTimers()
    stubIframe()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    ) // never resolves
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const btn = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(btn.style.opacity).toBe('0')
    vi.advanceTimersByTime(1800)
    expect(btn.style.opacity).toBe('1')
    vi.useRealTimers()
  })

  it('init throws on non-http(s) instanceUrl (javascript: scheme)', () => {
    const sdk = createSDK()
    expect(() => sdk.dispatch('init', { instanceUrl: 'javascript:alert(1)' })).toThrow(
      /instanceUrl must be an http/
    )
  })

  it('init throws on malformed instanceUrl', () => {
    const sdk = createSDK()
    expect(() => sdk.dispatch('init', { instanceUrl: 'not a url' })).toThrow(
      /instanceUrl must be an http/
    )
  })

  it('navigate opens http(s) URLs with noopener,noreferrer', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: { type: 'quackback:navigate', url: 'https://example.com/thing' },
      })
    )
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/thing',
      '_blank',
      'noopener,noreferrer'
    )
    openSpy.mockRestore()
  })

  it('navigate ignores javascript: URLs', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: { type: 'quackback:navigate', url: 'javascript:alert(1)' },
      })
    )
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('destroy removes the iframe and launcher', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
    sdk.dispatch('destroy')
    expect(document.querySelector('iframe.quackback-widget-iframe')).toBeNull()
    expect(document.querySelector('button[aria-label="Open feedback widget"]')).toBeNull()
  })

  // Earlier tests leave their SDKs listening for ORIGIN, so these use origins
  // of their own to count only their own messages.
  function shownStates(postMessage: ReturnType<typeof vi.fn>, origin: string) {
    return postMessage.mock.calls
      .filter(([msg, to]) => to === origin && (msg as { type: string }).type === 'quackback:shown')
      .map(([msg]) => (msg as { data: unknown }).data)
  }

  function fireFrom(origin: string, type: string) {
    window.dispatchEvent(new MessageEvent('message', { origin, data: { type } }))
  }

  it('tells the frame whether it is shown, so a closed panel leaves new replies unread', () => {
    const origin = 'https://shown-1.example.com'
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })

    // The preloaded panel starts hidden.
    fireFrom(origin, 'quackback:ready')
    expect(shownStates(postMessage, origin)).toEqual([false])

    sdk.dispatch('open')
    sdk.dispatch('close')
    sdk.dispatch('open')
    // The frame's own close button closes the panel too.
    fireFrom(origin, 'quackback:close')
    sdk.dispatch('open')
    sdk.dispatch('logout')
    expect(shownStates(postMessage, origin)).toEqual([false, true, false, true, false, true, false])
    sdk.dispatch('destroy')
    spy.mockRestore()
  })

  it('navigates before saying the panel is shown, so the view it was closed on stays unseen', () => {
    const origin = 'https://shown-3.example.com'
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    fireFrom(origin, 'quackback:ready')
    postMessage.mockClear()
    sdk.dispatch('open', { view: 'messages' })
    const types = postMessage.mock.calls
      .filter(([, to]) => to === origin)
      .map(([msg]) => (msg as { type: string }).type)
    expect(types).toEqual(['quackback:open', 'quackback:shown'])
    sdk.dispatch('destroy')
    spy.mockRestore()
  })

  it('a panel opened before the frame was ready is shown once it is', () => {
    const origin = 'https://shown-2.example.com'
    const { postMessage, spy } = stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    sdk.dispatch('open')
    fireFrom(origin, 'quackback:ready')
    expect(shownStates(postMessage, origin)).toEqual([true])
    sdk.dispatch('destroy')
    spy.mockRestore()
  })

  it('an iframe unread count drives the launcher badge and unread subscribers', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const handler = vi.fn()
    sdk.dispatch('on', 'unread', handler)

    window.dispatchEvent(
      new MessageEvent('message', { origin: ORIGIN, data: { type: 'quackback:unread', count: 5 } })
    )

    // Host subscribers get the count...
    expect(handler).toHaveBeenCalledWith({ count: 5 })
    // ...and the launcher shows the badge.
    const badge = (
      document.querySelector('button[aria-label="Open feedback widget"]') as HTMLButtonElement
    ).lastElementChild as HTMLElement
    expect(badge.style.display).toBe('flex')
    expect(badge.textContent).toBe('5')
  })
})

describe('sdk server-driven launcher config', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: () => void) => {
        cb()
        return 1
      })
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__
  })

  it('server config position and label reach the launcher, overriding init placement', () => {
    stubIframe()
    window.__QUACKBACK_CONFIG__ = { position: 'left', launcherLabel: 'Chat with us' }
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, placement: 'right' })
    const btn = document.querySelector('button[aria-label="Chat with us"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.style.left).toBe('calc(24px + env(safe-area-inset-left, 0px))')
    expect(btn.style.right).toBe('')
    expect(btn.textContent).toContain('Chat with us')
  })

  it('a fetched server config positions and labels the launcher', async () => {
    stubIframe()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ position: 'left', launcherLabel: 'Feedback' }),
      }))
    )
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    await new Promise((r) => setTimeout(r, 0))
    const btn = document.querySelector('button[aria-label="Feedback"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.style.left).toBe('calc(24px + env(safe-area-inset-left, 0px))')
  })

  it('no server position keeps the init placement', () => {
    stubIframe()
    window.__QUACKBACK_CONFIG__ = { theme: {} }
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, placement: 'left' })
    const btn = document.querySelector(
      'button[aria-label="Open feedback widget"]'
    ) as HTMLButtonElement
    expect(btn.style.left).toBe('calc(24px + env(safe-area-inset-left, 0px))')
  })
})

describe('sdk on phones', () => {
  const origin = 'https://safe-area.example.com'
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) }))
    )
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: () => void) => {
        cb()
        return 1
      })
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function phone(matches: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    )
  }

  // The host page's safe-area insets (a home indicator, an edge-to-edge
  // navigation bar). The frame cannot read them, so the SDK measures them.
  // Returns how many times it measured.
  function hostInsets(top: string, bottom: string, left = '0px', right = '0px') {
    const real = window.getComputedStyle.bind(window)
    let measured = 0
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if ((el as HTMLElement).dataset?.quackbackSafeArea === undefined) return real(el)
      measured++
      return {
        paddingTop: top,
        paddingBottom: bottom,
        paddingLeft: left,
        paddingRight: right,
      } as CSSStyleDeclaration
    })
    return () => measured
  }

  // Animation frames run only when the test flushes them.
  function manualFrames() {
    let queue: FrameRequestCallback[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => queue.push(cb))
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    return () => {
      const run = queue
      queue = []
      for (const cb of run) cb(0)
    }
  }

  function frameWindow() {
    const postMessage = vi.fn()
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage,
    } as unknown as Window)
    return postMessage
  }

  function frameReady() {
    window.dispatchEvent(new MessageEvent('message', { origin, data: { type: 'quackback:ready' } }))
  }

  function sentSafeAreas(postMessage: ReturnType<typeof vi.fn>) {
    return postMessage.mock.calls
      .filter(
        ([msg, to]) => to === origin && (msg as { type: string }).type === 'quackback:safe-area'
      )
      .map(([msg]) => (msg as { data: unknown }).data)
  }

  it('sizes the full-screen panel to the visible viewport, not the largest one', () => {
    phone(true)
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    const css = document.getElementById('quackback-widget-styles')?.textContent ?? ''
    const phoneRules = css.slice(css.indexOf('@media(max-width:639px)'))
    expect(phoneRules).toContain('height:100dvh')
    sdk.dispatch('destroy')
  })

  it('measures nothing while the panel is closed', () => {
    phone(true)
    const measured = hostInsets('47px', '34px')
    const flush = manualFrames()
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    frameReady()
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(measured()).toBe(0)
    expect(sentSafeAreas(postMessage)).toEqual([])
    sdk.dispatch('destroy')
  })

  it('tells the frame the host page insets before the open panel shows', () => {
    phone(true)
    hostInsets('47px', '34px')
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    frameReady()
    let shownWhenSent: boolean | null = null
    postMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type !== 'quackback:safe-area') return
      const panel = document.querySelector('.quackback-panel')
      shownWhenSent = !!panel?.classList.contains('quackback-open')
    })
    sdk.dispatch('open')
    expect(sentSafeAreas(postMessage)).toEqual([{ top: 47, bottom: 34, left: 0, right: 0 }])
    expect(shownWhenSent).toBe(false)
    sdk.dispatch('destroy')
  })

  it('sends the insets when a frame loads behind an open panel', () => {
    phone(true)
    hostInsets('47px', '34px')
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    sdk.dispatch('open')
    expect(sentSafeAreas(postMessage)).toEqual([])
    frameReady()
    expect(sentSafeAreas(postMessage)).toEqual([{ top: 47, bottom: 34, left: 0, right: 0 }])
    sdk.dispatch('destroy')
  })

  it('measures a rotation once per frame while open, and sends only a change', () => {
    phone(true)
    const opened = hostInsets('47px', '34px')
    const flush = manualFrames()
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    frameReady()
    sdk.dispatch('open')
    expect(opened()).toBe(1)

    // A rotation fires a burst of resizes; one measurement per frame.
    const rotated = hostInsets('0px', '21px')
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(rotated()).toBe(0)
    flush()
    expect(rotated()).toBe(1)
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(sentSafeAreas(postMessage)).toEqual([
      { top: 47, bottom: 34, left: 0, right: 0 },
      { top: 0, bottom: 21, left: 0, right: 0 },
    ])

    // Closed again, resizes cost nothing.
    sdk.dispatch('close')
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(rotated()).toBe(2)
    sdk.dispatch('destroy')
  })

  it('tells the frame the side insets of a phone held sideways', () => {
    phone(true)
    hostInsets('0px', '21px', '47px', '0px')
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    frameReady()
    sdk.dispatch('open')
    expect(sentSafeAreas(postMessage)).toEqual([{ top: 0, bottom: 21, left: 47, right: 0 }])
    sdk.dispatch('destroy')
  })

  it('sends no insets for the floating desktop panel, which never touches the screen edge', () => {
    phone(false)
    const measured = hostInsets('47px', '34px')
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    frameReady()
    sdk.dispatch('open')
    expect(sentSafeAreas(postMessage)).toEqual([{ top: 0, bottom: 0, left: 0, right: 0 }])
    expect(measured()).toBe(0)
    sdk.dispatch('destroy')
  })
})
