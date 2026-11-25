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
    expect(document.querySelector('button[aria-label="Open help"]')).not.toBeNull()
    expect(document.querySelector('iframe.quackback-widget-iframe')).not.toBeNull()
  })

  it('init with { launcher: false } does not create a button', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    expect(document.querySelector('button[aria-label="Open help"]')).toBeNull()
  })

  it('a repeat init re-applies launcher: false', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(document.querySelector('button[aria-label="Open help"]')).not.toBeNull()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    expect(document.querySelector('button[aria-label="Open help"]')).toBeNull()
  })

  it('a repeat init moves an existing launcher to the new placement', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    sdk.dispatch('init', { instanceUrl: ORIGIN, placement: 'left' })
    const btn = document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement
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
    const launcher = document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement
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
      document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement | null
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
    const btn = document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement
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
    const btn = document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement
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
    const btn = document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement
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
    expect(document.querySelector('button[aria-label="Open help"]')).toBeNull()
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
    // The safe-area insets go first (see the safe-area tests); this checks
    // only that the view navigates before the panel says it is shown.
    const types = postMessage.mock.calls
      .filter(([, to]) => to === origin)
      .map(([msg]) => (msg as { type: string }).type)
      .filter((type) => type !== 'quackback:safe-area')
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
    const btn = document.querySelector('button[aria-controls="quackback-panel"]') as HTMLElement
    const badge = btn.lastElementChild as HTMLElement
    expect(badge.style.display).toBe('flex')
    expect(badge.textContent).toBe('5')
    // ...and a screen reader hears the same count.
    expect(btn.getAttribute('aria-label')).toBe('Open help, 5 unread')
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
    const btn = document.querySelector('button[aria-label="Open help"]') as HTMLButtonElement
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
  const real = window.getComputedStyle.bind(window)
  function hostInsets(top: string, bottom: string, left = '0px', right = '0px') {
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

  it('decides full screen by the same media query as the panel stylesheet', () => {
    const queries: string[] = []
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => {
        queries.push(query)
        return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
      })
    )
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    const css = document.getElementById('quackback-widget-styles')?.textContent ?? ''
    const fullScreen = queries.filter((q) => !q.includes('prefers-reduced-motion'))
    expect(fullScreen.length).toBeGreaterThan(0)
    for (const query of fullScreen) expect(css).toContain(`@media${query}{`)
    sdk.dispatch('destroy')
  })

  it('sends the insets before an open queued until the frame was ready', () => {
    phone(true)
    hostInsets('47px', '34px')
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    sdk.dispatch('open', { view: 'messages' })
    frameReady()
    const types = postMessage.mock.calls
      .map(([msg]) => (msg as { type: string }).type)
      .filter((t) => t === 'quackback:safe-area' || t === 'quackback:open')
    expect(types).toEqual(['quackback:safe-area', 'quackback:open'])
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

  it('tells the frame the side insets the full-screen panel meets', () => {
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

  it('drops the bottom inset while the on-screen keyboard covers the home indicator', () => {
    phone(true)
    const measured = hostInsets('47px', '34px')
    const flush = manualFrames()
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      offsetTop: 0,
    })
    vi.stubGlobal('visualViewport', viewport)
    const postMessage = frameWindow()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: origin })
    frameReady()

    // Closed, the keyboard (for the host page's own fields) costs nothing.
    viewport.height = window.innerHeight - 300
    viewport.dispatchEvent(new Event('resize'))
    flush()
    expect(measured()).toBe(0)
    viewport.height = window.innerHeight
    viewport.dispatchEvent(new Event('resize'))
    flush()

    sdk.dispatch('open')
    flush()
    expect(sentSafeAreas(postMessage)).toEqual([{ top: 47, bottom: 34, left: 0, right: 0 }])

    // The keyboard opens in steps; one update per frame.
    viewport.height = window.innerHeight - 150
    viewport.dispatchEvent(new Event('resize'))
    viewport.height = window.innerHeight - 300
    viewport.dispatchEvent(new Event('resize'))
    flush()
    // A toolbar sliding away is not a keyboard.
    viewport.height = window.innerHeight - 60
    viewport.dispatchEvent(new Event('resize'))
    flush()
    // The keyboard closes.
    viewport.height = window.innerHeight
    viewport.dispatchEvent(new Event('resize'))
    flush()
    expect(sentSafeAreas(postMessage)).toEqual([
      { top: 47, bottom: 34, left: 0, right: 0 },
      { top: 47, bottom: 0, left: 0, right: 0 },
      { top: 47, bottom: 34, left: 0, right: 0 },
    ])
    sdk.dispatch('destroy')
  })

  // The floating panel never touches the screen edge: its CSS offsets
  // already move it in by the side and bottom insets.
  it('sends no insets for the floating panel', () => {
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

describe('sdk panel as a dialog', () => {
  // Frame callbacks run only when the test says so.
  let frames: Array<() => void> = []
  function runFrames() {
    const due = frames
    frames = []
    for (const cb of due) cb()
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    frames = []
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
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: () => void) => frames.push(cb))
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__
  })

  const panelEl = () => document.querySelector('.quackback-panel') as HTMLElement
  const iframeEl = () =>
    document.querySelector('iframe.quackback-widget-iframe') as HTMLIFrameElement
  const launcherEl = () =>
    document.querySelector('button[aria-controls]') as HTMLButtonElement | null

  it('is a labelled dialog the launcher controls', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, locale: 'de' })
    expect(panelEl().getAttribute('role')).toBe('dialog')
    expect(panelEl().getAttribute('aria-label')).toBe('Hilfe')
    expect(panelEl().id).toBe('quackback-panel')
    expect(launcherEl()!.getAttribute('aria-controls')).toBe(panelEl().id)
  })

  it('moves focus into the panel on open and back to the launcher on close', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    launcherEl()!.focus()
    sdk.dispatch('open')
    runFrames()
    expect(document.activeElement).toBe(iframeEl())
    sdk.dispatch('close')
    expect(document.activeElement).toBe(launcherEl())
  })

  it('leaves focus alone on close when it is elsewhere on the page', () => {
    stubIframe()
    const input = document.createElement('input')
    document.body.appendChild(input)
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    sdk.dispatch('open')
    runFrames()
    input.focus()
    sdk.dispatch('close')
    expect(document.activeElement).toBe(input)
  })

  function hostButton(): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = 'Help'
    document.body.appendChild(button)
    return button
  }

  it("returns focus to the host page's own button when there is no launcher", () => {
    stubIframe()
    const button = hostButton()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    button.focus()
    sdk.dispatch('open')
    runFrames()
    expect(document.activeElement).toBe(iframeEl())
    sdk.dispatch('close')
    expect(document.activeElement).toBe(button)
  })

  it('returns focus to the opener after hideLauncher', () => {
    stubIframe()
    const button = hostButton()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    sdk.dispatch('hideLauncher')
    button.focus()
    sdk.dispatch('open')
    runFrames()
    sdk.dispatch('close')
    expect(document.activeElement).toBe(button)
  })

  it.each([
    ['removed', (b: HTMLElement) => b.remove()],
    ['hidden', (b: HTMLElement) => (b.style.display = 'none')],
  ])('falls back to the launcher when the opener was %s', (_, change) => {
    stubIframe()
    const button = hostButton()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    button.focus()
    sdk.dispatch('open')
    runFrames()
    change(button)
    sdk.dispatch('close')
    expect(document.activeElement).toBe(launcherEl())
  })

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div')
        div.contentEditable = 'true'
        div.tabIndex = 0
        return div
      },
    ],
  ])('a host-triggered open leaves focus in a %s the visitor is typing in', (_, make) => {
    stubIframe()
    const field = make()
    document.body.appendChild(field)
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    field.focus()
    expect(document.activeElement).toBe(field)
    sdk.dispatch('open')
    runFrames()
    expect(document.activeElement).toBe(field)
  })

  it('a host-triggered open with nothing focused moves focus into the panel', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    sdk.dispatch('open')
    runFrames()
    expect(document.activeElement).toBe(iframeEl())
  })

  it('a launcher click moves focus into the panel even if a field kept focus', () => {
    stubIframe()
    const field = document.createElement('input')
    document.body.appendChild(field)
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    field.focus()
    // Some browsers do not focus a button on click.
    launcherEl()!.click()
    runFrames()
    expect(document.activeElement).toBe(iframeEl())
    launcherEl()!.click()
    expect(document.activeElement).toBe(field)
  })

  it('does not pull focus into a panel that closed before the next frame', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const focus = vi.spyOn(iframeEl(), 'focus')
    sdk.dispatch('open')
    sdk.dispatch('close')
    runFrames()
    expect(focus).not.toHaveBeenCalled()
  })

  it('logout closes an open panel with a close event, and is quiet when closed', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const onClose = vi.fn()
    sdk.dispatch('on', 'close', onClose)
    sdk.dispatch('logout')
    expect(onClose).not.toHaveBeenCalled()
    sdk.dispatch('open')
    sdk.dispatch('logout')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sdk.isOpen()).toBe(false)
  })

  it('showLauncher brings up a revealed, branded launcher after init({ launcher: false })', () => {
    stubIframe()
    window.__QUACKBACK_CONFIG__ = {
      theme: { lightPrimary: '#ff0000', lightPrimaryForeground: '#ffffff', themeMode: 'light' },
      launcherLabel: 'Chat with us',
    }
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    expect(launcherEl()).toBeNull()
    window.dispatchEvent(
      new MessageEvent('message', { origin: ORIGIN, data: { type: 'quackback:unread', count: 2 } })
    )
    sdk.dispatch('showLauncher')
    const btn = launcherEl()!
    expect(btn).not.toBeNull()
    expect(btn.style.opacity).toBe('1')
    expect(btn.style.backgroundColor).toBe('#ff0000')
    expect(btn.textContent).toContain('Chat with us')
    // It carries the unread count that arrived before it existed...
    expect(btn.getAttribute('aria-label')).toBe('Chat with us, 2 unread')
    // ...and reflects a panel that is already open.
    sdk.dispatch('hideLauncher')
    sdk.dispatch('destroy')
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    sdk.dispatch('open')
    sdk.dispatch('showLauncher')
    expect(launcherEl()!.getAttribute('aria-expanded')).toBe('true')
  })

  it('hideLauncher hides the greeting bubble too', () => {
    stubIframe()
    window.__QUACKBACK_CONFIG__ = { launcherGreeting: 'Need a hand?' }
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const bubble = Array.from(document.body.querySelectorAll('div')).find(
      (d) => d.textContent === 'Need a hand?×'
    ) as HTMLElement
    expect(bubble.style.display).toBe('flex')
    sdk.dispatch('hideLauncher')
    expect(launcherEl()!.style.display).toBe('none')
    expect(bubble.style.display).toBe('none')
    sdk.dispatch('showLauncher')
    expect(launcherEl()!.style.display).toBe('flex')
    expect(bubble.style.display).toBe('flex')
  })

  it('answers isOpen, getUser and isIdentified through dispatch', () => {
    stubIframe()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(sdk.dispatch('isOpen')).toBe(false)
    expect(sdk.dispatch('getUser')).toBeNull()
    expect(sdk.dispatch('isIdentified')).toBe(false)
    sdk.dispatch('open')
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: { type: 'quackback:identify-result', success: true, user: { id: 'user_a' } },
      })
    )
    expect(sdk.dispatch('isOpen')).toBe(true)
    expect(sdk.dispatch('getUser')).toEqual({ id: 'user_a' })
    expect(sdk.dispatch('isIdentified')).toBe(true)
  })

  it('fits the phone panel to the visible viewport while open', () => {
    stubIframe()
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('max-width:639px'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    const viewport = Object.assign(new EventTarget(), { height: 380, offsetTop: 12 })
    vi.stubGlobal('visualViewport', viewport)
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    expect(panelEl().style.height).toBe('')
    sdk.dispatch('open')
    expect(panelEl().style.height).toBe('380px')
    expect(panelEl().style.top).toBe('12px')
    sdk.dispatch('close')
    expect(panelEl().style.height).toBe('')
    expect(panelEl().style.top).toBe('')
    // Destroy stops listening.
    sdk.dispatch('open')
    sdk.dispatch('destroy')
    frames = []
    viewport.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(0)
  })
})

describe('sdk panel stylesheet', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) }))
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function css(): string {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    sdk.dispatch('open')
    const text = document.getElementById('quackback-widget-styles')?.textContent ?? ''
    sdk.dispatch('destroy')
    return text
  }

  it('sizes the desktop panel to fit the window', () => {
    const text = css()
    expect(text).toContain(
      'width:min(400px,calc(100vw - 48px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)))'
    )
    expect(text).toContain(
      'height:min(704px,calc(100vh - 108px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)))'
    )
    expect(text).toContain('border-radius:16px')
  })

  it('goes full screen on a phone held sideways, expanded or not', () => {
    const text = css()
    const query = '@media(max-width:639px),(max-height:500px) and (pointer:coarse){'
    expect(text).toContain(query)
    const phoneRules = text.slice(text.indexOf(query))
    // The desktop "expanded" size would otherwise win on a wide, short screen.
    expect(phoneRules).toMatch(/\.quackback-panel\.quackback-expanded[,{][^}]*height:100dvh/)
  })

  it('drops the panel and backdrop animation for reduced motion', () => {
    const text = css()
    const rule = text.slice(text.indexOf('@media(prefers-reduced-motion:reduce)'))
    expect(rule).toContain('.quackback-panel')
    expect(rule).toContain('.quackback-backdrop')
    expect(rule).toContain('transition:none!important')
  })
})
