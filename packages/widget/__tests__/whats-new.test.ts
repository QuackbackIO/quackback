// @vitest-environment happy-dom
/**
 * The "What's new" card above the closed launcher: the frame's newest unread
 * changelog entry, one card at a time with the greeting, opening the widget
 * on that entry, and dismissible until a newer entry is published without
 * touching the unread badge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLauncher as createHiddenLauncher } from '../src/core/launcher'
import { parseWhatsNew, type WhatsNew } from '../src/core/whats-new-card'
import { createSDK } from '../src/core/sdk'

const ORIGIN = 'https://feedback.acme.com'

// Messages from the panel come from its iframe's window; the bridge drops any
// other source.
function panelWindow() {
  const iframe = document.querySelector(
    'iframe.quackback-widget-iframe'
  ) as HTMLIFrameElement | null
  return iframe?.contentWindow ?? null
}

/** A launcher past its reveal, as a visitor sees it. */
function createLauncher(opts: Parameters<typeof createHiddenLauncher>[0]) {
  const l = createHiddenLauncher(opts)
  l.reveal()
  return l
}

function sample(over: Partial<WhatsNew['entry']> = {}, count = 2): WhatsNew {
  return {
    count,
    entry: {
      id: 'changelog_1',
      title: 'Faster search',
      excerpt: 'Search now answers in half the time across every board.',
      publishedAt: '2026-11-20T10:00:00.000Z',
      date: 'Nov 20, 2026',
      ...over,
    },
    strings: {
      pill: `${count} new updates`,
      action: "See what's new",
      dismiss: 'Dismiss',
      label: "What's new",
    },
  }
}

const cardEl = () => document.querySelector('[data-quackback-whats-new]') as HTMLElement | null
const dismissBtn = () => cardEl()!.querySelector('button[aria-label="Dismiss"]') as HTMLElement
const actionBtn = () =>
  Array.from(cardEl()!.querySelectorAll('button')).find(
    (b) => b.textContent === "See what's new"
  ) as HTMLElement
const shown = () => !!cardEl() && cardEl()!.style.display !== 'none'

function clearStorage() {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}

describe('parseWhatsNew', () => {
  it('reads a well-formed payload', () => {
    expect(parseWhatsNew(sample())).toEqual(sample())
  })

  it('reads null, a zero count or a missing title as no card', () => {
    expect(parseWhatsNew(null)).toBeNull()
    expect(parseWhatsNew({ ...sample(), count: 0 })).toBeNull()
    expect(parseWhatsNew(sample({ title: '' }))).toBeNull()
    expect(parseWhatsNew({ count: 1, entry: 'nope' })).toBeNull()
  })

  it('caps long text between code points, never inside an emoji', () => {
    const title = 'a'.repeat(199) + '\u{1F680}' + 'tail'
    const parsed = parseWhatsNew(sample({ title }))!
    expect(Array.from(parsed.entry.title)).toHaveLength(200)
    expect(parsed.entry.title.endsWith('\u{1F680}')).toBe(true)
  })
})

describe("launcher What's new card", () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the pill, title, excerpt, action, date and a 32px dismiss while closed', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    expect(shown()).toBe(true)
    const text = cardEl()!.textContent!
    expect(text).toContain('2 new updates')
    expect(text).toContain('Faster search')
    expect(text).toContain('Search now answers in half the time')
    expect(text).toContain("See what's new")
    expect(text).toContain('Nov 20, 2026')
    expect(dismissBtn().style.width).toBe('32px')
    expect(dismissBtn().style.height).toBe('32px')
  })

  it('sits above the button, clear of the home indicator', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    expect(cardEl()!.style.bottom).toContain('safe-area-inset-bottom')
    expect(cardEl()!.style.right).toContain('safe-area-inset-right')
    l.setPlacement('left')
    expect(cardEl()!.style.left).toContain('safe-area-inset-left')
    expect(cardEl()!.style.right).toBe('')
  })

  it('is a named region announced politely, once per entry', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    const flush = () => frames.splice(0).forEach((cb) => cb(0))
    const onShown = vi.fn()
    const l = createLauncher({ placement: 'right', onClick: () => {}, onWhatsNewShown: onShown })
    // The polite region exists before any card, outside it.
    const status = document.querySelector('[role="status"]') as HTMLElement
    expect(status.getAttribute('aria-live')).toBe('polite')
    l.setWhatsNew(sample())
    expect(cardEl()!.getAttribute('role')).toBe('region')
    expect(cardEl()!.getAttribute('aria-label')).toBe("What's new")
    expect(cardEl()!.contains(status)).toBe(false)
    // The text lands a frame after the card shows.
    expect(status.textContent).toBe('')
    flush()
    expect(status.textContent).toBe('2 new updates: Faster search')
    // Reopening the launcher does not say it again.
    l.setOpen(true)
    l.setOpen(false)
    flush()
    expect(status.textContent).toBe('')
    l.setWhatsNew(sample({ id: 'changelog_2', title: 'Dark mode' }, 3))
    flush()
    expect(onShown).toHaveBeenLastCalledWith(expect.objectContaining({ count: 3 }))
    expect(status.textContent).toBe('3 new updates: Dark mode')
    l.remove()
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  it('hides while the widget is open or the launcher is hidden', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    l.setOpen(true)
    expect(shown()).toBe(false)
    l.setOpen(false)
    expect(shown()).toBe(true)
    l.setVisible(false)
    expect(shown()).toBe(false)
    l.setVisible(true)
    expect(shown()).toBe(true)
    l.setWhatsNew(null)
    expect(shown()).toBe(false)
  })

  it('takes the place of the greeting bubble, which returns once the card goes', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setGreeting('Need a hand?')
    const bubble = document.querySelector('body > div') as HTMLElement
    expect(bubble.style.display).toBe('flex')
    l.setWhatsNew(sample())
    expect(bubble.style.display).toBe('none')
    expect(shown()).toBe(true)
    l.setWhatsNew(null)
    expect(bubble.style.display).toBe('flex')
  })

  it('opens on the entry from the card or its action, once per click', () => {
    const onOpen = vi.fn()
    const onClick = vi.fn()
    const l = createLauncher({ placement: 'right', onClick, onWhatsNewOpen: onOpen })
    l.setWhatsNew(sample())
    cardEl()!.click()
    expect(onOpen).toHaveBeenCalledWith('changelog_1')
    actionBtn().click()
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('dismisses without opening, and leaves the unread badge alone', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    const l = createLauncher({
      placement: 'right',
      onClick: () => {},
      onWhatsNewOpen: onOpen,
      onWhatsNewDismiss: onDismiss,
    })
    l.setUnread(2)
    l.setWhatsNew(sample())
    dismissBtn().click()
    expect(onDismiss).toHaveBeenCalledWith('changelog_1')
    expect(onOpen).not.toHaveBeenCalled()
    expect(shown()).toBe(false)
    const badge = l.el.lastElementChild as HTMLElement
    expect(badge.style.display).toBe('flex')
    expect(badge.textContent).toBe('2')
  })

  it('Esc inside the card dismisses it and returns focus to the launcher', () => {
    const onDismiss = vi.fn()
    const l = createLauncher({
      placement: 'right',
      onClick: () => {},
      onWhatsNewDismiss: onDismiss,
    })
    l.setWhatsNew(sample())
    actionBtn().focus()
    expect(document.activeElement).toBe(actionBtn())
    actionBtn().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onDismiss).toHaveBeenCalledWith('changelog_1')
    expect(shown()).toBe(false)
    expect(document.activeElement).toBe(l.el)
  })

  it('spans the phone screen less the side margins, clear of a notch', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('max-width: 639px'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    expect(cardEl()!.style.left).toContain('safe-area-inset-left')
    expect(cardEl()!.style.right).toContain('safe-area-inset-right')
    expect(cardEl()!.style.width).toBe('auto')
    expect(cardEl()!.style.bottom).toContain('safe-area-inset-bottom')
  })

  it('enters without motion when reduced motion is on', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    expect(cardEl()!.style.transition).toBe('none')
    expect(cardEl()!.style.transform).toBe('')
  })

  it('slides in otherwise', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    expect(cardEl()!.style.transition).toContain('transform')
  })

  it('follows a reduced-motion change made while the page is open', () => {
    const listeners: (() => void)[] = []
    const motion = { matches: false }
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          return query.includes('prefers-reduced-motion') && motion.matches
        },
        addEventListener: (_: string, cb: () => void) => listeners.push(cb),
        removeEventListener: vi.fn(),
      }))
    )
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    expect(cardEl()!.style.transition).toContain('transform')
    motion.matches = true
    listeners.forEach((cb) => cb())
    expect(cardEl()!.style.transition).toBe('none')
  })

  it('waits for the launcher to be revealed', () => {
    const l = createHiddenLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    l.setGreeting('Need a hand?')
    expect(shown()).toBe(false)
    expect((document.querySelector('body > div') as HTMLElement).style.display).toBe('none')
    l.reveal()
    expect(shown()).toBe(true)
  })

  it('keeps the greeting back for the page load after a dismiss', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setGreeting('Need a hand?')
    l.setWhatsNew(sample())
    dismissBtn().click()
    const bubble = document.querySelector('body > div') as HTMLElement
    expect(bubble.style.display).toBe('none')
    l.setOpen(true)
    l.setOpen(false)
    expect(bubble.style.display).toBe('none')
  })

  it('clears the live region when the card hides, and repeats are announced afresh', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const flush = () => frames.splice(0).forEach((cb) => cb(0))
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    const status = document.querySelector('[role="status"]') as HTMLElement
    l.setWhatsNew(sample())
    flush()
    expect(status.textContent).toBe('2 new updates: Faster search')
    l.setOpen(true)
    expect(status.textContent).toBe('')
    l.setOpen(false)
    l.setWhatsNew(sample({ id: 'changelog_2', title: 'Dark mode' }, 3))
    // Emptied before the new words land a frame later.
    expect(status.textContent).toBe('')
    flush()
    expect(status.textContent).toBe('3 new updates: Dark mode')
  })

  it('reports every appearance, so the host decides what is new', () => {
    const onShown = vi.fn()
    const l = createLauncher({ placement: 'right', onClick: () => {}, onWhatsNewShown: onShown })
    l.setWhatsNew(sample())
    l.setWhatsNew(sample())
    expect(onShown).toHaveBeenCalledTimes(1)
    l.setOpen(true)
    l.setOpen(false)
    expect(onShown).toHaveBeenCalledTimes(2)
  })

  it('goes with the launcher', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setWhatsNew(sample())
    l.remove()
    expect(cardEl()).toBeNull()
  })
})

const memoryKey = (scope: string) => `quackback:whats-new:${ORIGIN}:${scope}`

/** Visitors this device has a What's new record for. */
function returning(...scopes: string[]) {
  for (const scope of scopes) localStorage.setItem(memoryKey(scope), '{}')
}

describe("sdk What's new card for visitors known on this device", () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    clearStorage()
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
    // A panel window for messages to come from (happy-dom loads no frames).
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage: vi.fn(),
    } as unknown as Window)
    // Script-tag installs reveal the launcher at once from the baked config.
    ;(window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__ = { theme: {} }
    // These visitors have been here before; first visits are tested below.
    returning('anon', 'user:user_a', 'user:user_b')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__
  })

  function post(data: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent('message', { source: panelWindow(), origin: ORIGIN, data })
    )
  }
  const announce = (whatsNew: unknown) => post({ type: 'quackback:whats-new', whatsNew })

  function stubFrame() {
    const postMessage = vi.fn()
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage,
    } as unknown as Window)
    return postMessage
  }

  it('shows the card from the frame and tells subscribers once', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const handler = vi.fn()
    sdk.dispatch('on', 'whats-new', handler)
    announce(sample())
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenCalledWith({ count: 2, entryId: 'changelog_1' })
    announce(sample())
    expect(handler).toHaveBeenCalledTimes(1)
    sdk.dispatch('destroy')
  })

  it('clears the card on null or a malformed payload', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    announce(null)
    expect(shown()).toBe(false)
    announce(sample())
    announce({ count: 'many' })
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('opens the widget on the entry, and the card stays answered after close', () => {
    const postMessage = stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:ready' })
    const onOpen = vi.fn()
    sdk.dispatch('on', 'open', onOpen)
    announce(sample())
    cardEl()!.click()
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'changelog', entryId: 'changelog_1' })
    )
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:open', data: { view: 'changelog', entryId: 'changelog_1' } },
      ORIGIN
    )
    expect(sdk.isOpen()).toBe(true)
    sdk.dispatch('close')
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('remembers a dismiss per instance until a newer entry, and keeps the badge', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:unread', count: 2 })
    announce(sample())
    dismissBtn().click()
    expect(shown()).toBe(false)
    expect(JSON.parse(localStorage.getItem(`quackback:whats-new:${ORIGIN}:anon`)!)).toMatchObject({
      through: '2026-11-20T10:00:00.000Z',
      answered: ['changelog_1'],
    })
    const btn = document.querySelector('button[aria-label^="Open help"]') as HTMLElement
    expect((btn.lastElementChild as HTMLElement).style.display).toBe('flex')
    expect(btn.getAttribute('aria-label')).toBe('Open help, 2 unread')

    // A later page load with the same newest entry keeps it dismissed...
    sdk.dispatch('destroy')
    const again = createSDK()
    again.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    expect(shown()).toBe(false)
    // ...until a newer entry is published.
    announce(
      sample({ id: 'changelog_2', title: 'Dark mode', publishedAt: '2026-11-22T10:00:00.000Z' }, 3)
    )
    expect(shown()).toBe(true)
    again.dispatch('destroy')
  })

  it('fires whats-new once per entry per visitor, across page loads', () => {
    const first = createSDK()
    first.dispatch('init', { instanceUrl: ORIGIN })
    const handler = vi.fn()
    first.dispatch('on', 'whats-new', handler)
    announce(sample())
    expect(handler).toHaveBeenCalledTimes(1)
    first.dispatch('destroy')

    const second = createSDK()
    second.dispatch('init', { instanceUrl: ORIGIN })
    second.dispatch('on', 'whats-new', handler)
    announce(sample())
    // The card shows again (not answered), but the event does not repeat.
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    announce(sample({ id: 'changelog_2', publishedAt: '2026-11-22T10:00:00.000Z' }, 3))
    expect(handler).toHaveBeenLastCalledWith({ count: 3, entryId: 'changelog_2' })
    second.dispatch('destroy')
  })

  it('keeps an older entry answered when a newer answered one is unpublished', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample({ id: 'changelog_2', publishedAt: '2026-11-22T10:00:00.000Z' }))
    dismissBtn().click()
    // changelog_2 is unpublished: changelog_1, older, becomes the newest unread.
    announce(sample({ id: 'changelog_1', publishedAt: '2026-11-20T10:00:00.000Z' }))
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('bounds the remembered entries', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    for (let i = 0; i < 30; i++) {
      announce(
        sample({ id: `changelog_${i}`, publishedAt: `2026-11-${10 + (i % 18)}T10:00:00.000Z` })
      )
      if (shown()) dismissBtn().click()
    }
    const stored = JSON.parse(localStorage.getItem(`quackback:whats-new:${ORIGIN}:anon`)!)
    expect(stored.answered.length).toBeLessThanOrEqual(20)
    expect(stored.announced.length).toBeLessThanOrEqual(20)
    sdk.dispatch('destroy')
  })

  const userA = { id: 'user_a', name: 'Ada', email: 'ada@example.com' }
  const userB = { id: 'user_b', name: 'Bo', email: 'bo@example.com' }
  const resolved = (user: typeof userA | null) =>
    post({ type: 'quackback:identify-result', success: true, user })

  it("keeps one visitor's dismissal from hiding the card for another", () => {
    stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, identity: { ssoToken: 'token-a' } })
    post({ type: 'quackback:ready' })
    resolved(userA)
    announce(sample())
    expect(shown()).toBe(true)
    dismissBtn().click()
    expect(shown()).toBe(false)

    // Another person signs in on the same browser; the frame sends their card.
    sdk.dispatch('identify', { ssoToken: 'token-b' })
    resolved(userB)
    announce(sample())
    expect(shown()).toBe(true)
    // And an anonymous visitor has their own memory too.
    sdk.dispatch('logout')
    announce(sample())
    expect(shown()).toBe(true)
    sdk.dispatch('destroy')
  })

  it("drops the previous session's card when the visitor changes", () => {
    stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:ready' })
    const handler = vi.fn()
    sdk.dispatch('on', 'whats-new', handler)
    announce(sample())
    expect(handler).toHaveBeenCalledTimes(1)

    // Signing in: the anonymous session's entry is not shown as user A's.
    sdk.dispatch('identify', { ssoToken: 'token-a' })
    expect(shown()).toBe(false)
    resolved(userA)
    expect(shown()).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
    // The frame's card for the new session shows, and is new to this visitor.
    announce(sample({ id: 'changelog_2', publishedAt: '2026-11-22T10:00:00.000Z' }))
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenLastCalledWith({ count: 2, entryId: 'changelog_2' })

    // Logging out drops it too.
    sdk.dispatch('logout')
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('tells another known visitor about an entry an earlier visitor already saw', () => {
    stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:ready' })
    const handler = vi.fn()
    sdk.dispatch('on', 'whats-new', handler)
    announce(sample())
    sdk.dispatch('identify', { ssoToken: 'token-a' })
    resolved(userA)
    announce(sample())
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({ count: 2, entryId: 'changelog_1' })
    sdk.dispatch('destroy')
  })

  it('keeps the card while the same identity is sent again', () => {
    stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, identity: { ssoToken: 'token-a' } })
    post({ type: 'quackback:ready' })
    resolved(userA)
    announce(sample())
    expect(shown()).toBe(true)
    sdk.dispatch('identify', { ssoToken: 'token-a' })
    expect(shown()).toBe(true)
    sdk.dispatch('destroy')
  })

  it('hides the card when another tab of the host page dismisses it', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    expect(shown()).toBe(true)
    const key = `quackback:whats-new:${ORIGIN}:anon`
    localStorage.setItem(
      key,
      JSON.stringify({
        through: '2026-11-20T10:00:00.000Z',
        answered: ['changelog_1'],
        announced: [],
      })
    )
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(shown()).toBe(true)
    window.dispatchEvent(new StorageEvent('storage', { key }))
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('a launcher shown later carries the card', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    announce(sample())
    expect(cardEl()).toBeNull()
    sdk.dispatch('showLauncher')
    expect(shown()).toBe(true)
    sdk.dispatch('destroy')
    expect(cardEl()).toBeNull()
  })
})

describe("sdk What's new card: first visit and page choice", () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    clearStorage()
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
    // A panel window for messages to come from (happy-dom loads no frames).
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage: vi.fn(),
    } as unknown as Window)
    ;(window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__ = { theme: {} }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__
  })

  function post(data: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent('message', { source: panelWindow(), origin: ORIGIN, data })
    )
  }
  const announce = (whatsNew: unknown) => post({ type: 'quackback:whats-new', whatsNew })
  const badge = () => document.querySelector('button[aria-label^="Open help"]')!
  const newer = () =>
    sample({ id: 'changelog_2', title: 'Dark mode', publishedAt: '2026-11-22T10:00:00.000Z' }, 3)

  it('records what is unread on a first visit without showing the card or firing the event', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const handler = vi.fn()
    sdk.dispatch('on', 'whats-new', handler)
    post({ type: 'quackback:unread', count: 2, changelog: 2 })
    announce(sample())
    expect(shown()).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    // The badge is unchanged.
    expect(badge().getAttribute('aria-label')).toBe('Open help, 2 unread')
    expect(JSON.parse(localStorage.getItem(memoryKey('anon'))!)).toMatchObject({
      through: '2026-11-20T10:00:00.000Z',
      announced: ['changelog_1'],
    })
    // The same entry on a later page load stays quiet...
    sdk.dispatch('destroy')
    const again = createSDK()
    again.dispatch('init', { instanceUrl: ORIGIN })
    again.dispatch('on', 'whats-new', handler)
    announce(sample())
    expect(shown()).toBe(false)
    // ...and an entry published after the first visit is announced.
    announce(newer())
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenCalledWith({ count: 3, entryId: 'changelog_2' })
    again.dispatch('destroy')
  })

  it('keeps entries older than the one recorded on the first visit quiet', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(newer())
    // The newer one is read, so the older one becomes the newest unread.
    announce(sample())
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('shows the card as before when the host page blocks storage', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.stubGlobal('localStorage', {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
      clear: blocked,
    })
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    expect(shown()).toBe(true)
    // A dismiss still holds for the page load.
    dismissBtn().click()
    announce(sample())
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('starts the record from a first payload with nothing unread', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(null)
    expect(localStorage.getItem(memoryKey('anon'))).not.toBeNull()
    announce(sample())
    expect(shown()).toBe(true)
    sdk.dispatch('destroy')
  })

  it("waits for a new identity before recording that visitor's first visit", () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, identity: { ssoToken: 'token-a' } })
    // A payload while the identity resolves records nothing for anyone.
    announce(sample())
    expect(localStorage.getItem(memoryKey('anon'))).toBeNull()
    post({
      type: 'quackback:identify-result',
      success: true,
      user: { id: 'user_a', name: 'Ada', email: 'ada@example.com' },
    })
    // The frame sends the card for the new session: a first visit for user A.
    announce(sample())
    expect(shown()).toBe(false)
    expect(localStorage.getItem(memoryKey('user:user_a'))).not.toBeNull()
    announce(newer())
    expect(shown()).toBe(true)
    sdk.dispatch('destroy')
  })

  it('init({ whatsNew: false }) keeps the card off on this page, badge unchanged', () => {
    returning('anon')
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, whatsNew: false })
    const handler = vi.fn()
    sdk.dispatch('on', 'whats-new', handler)
    post({ type: 'quackback:unread', count: 2, changelog: 2 })
    announce(sample())
    expect(shown()).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    expect(badge().getAttribute('aria-label')).toBe('Open help, 2 unread')
    // Turned on while the page is open, the card shows.
    sdk.dispatch('whatsNew', true)
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    // And off again.
    sdk.dispatch('whatsNew', false)
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('a later init without the option keeps the last choice; with it, follows it', () => {
    returning('anon')
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, whatsNew: false })
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    expect(shown()).toBe(false)
    sdk.dispatch('init', { instanceUrl: ORIGIN, whatsNew: true })
    announce(sample())
    expect(shown()).toBe(true)
    sdk.dispatch('destroy')
  })

  it('a choice made before init holds, as with a script-tag install', () => {
    returning('anon')
    const sdk = createSDK()
    sdk.dispatch('whatsNew', false)
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('ignores a whatsNew call without a boolean', () => {
    returning('anon')
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    announce(sample())
    sdk.dispatch('whatsNew')
    sdk.dispatch('whatsNew', 'no')
    expect(shown()).toBe(true)
    sdk.dispatch('whatsNew', false)
    sdk.dispatch('whatsNew', 1)
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })
})
