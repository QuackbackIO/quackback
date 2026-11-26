// @vitest-environment happy-dom
/**
 * The reply preview above the closed launcher: the newest unread replies as
 * stacked bubbles beside the author's avatar, a reply pill that opens the
 * conversation, one card at a time ahead of What's new and the greeting, and
 * dismissible until a newer reply without touching the unread badge. Also
 * the host-side message event and the tab title flash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLauncher as createHiddenLauncher } from '../src/core/launcher'
import { initialsOf, parseReplyPreview, type ReplyPreview } from '../src/core/reply-preview-card'
import { createTitleAlert, TITLE_ALERT_INTERVAL_MS } from '../src/core/title-alert'
import { createSDK } from '../src/core/sdk'
import type { WhatsNew } from '../src/core/whats-new-card'

const ORIGIN = 'https://feedback.acme.com'

function createLauncher(opts: Parameters<typeof createHiddenLauncher>[0]) {
  const l = createHiddenLauncher(opts)
  l.reveal()
  return l
}

const msg = (n: number, text = `Reply ${n}`) => ({
  id: `conversation_msg_${n}`,
  text,
  createdAt: `2026-11-20T10:0${n}:00.000Z`,
})

function sample(over: Partial<ReplyPreview> = {}): ReplyPreview {
  return {
    conversationId: 'conversation_1',
    author: { name: 'Alex Kim', firstName: 'Alex', avatarUrl: null },
    teamName: 'Acme',
    messages: [msg(1), msg(2)],
    count: 2,
    full: false,
    strings: {
      header: 'Alex from Acme',
      replyTo: 'Reply to Alex…',
      newReplies: '2 new replies',
      dismiss: 'Dismiss',
      label: 'New reply from Alex',
      announce: 'New reply from Alex',
    },
    ...over,
  }
}

const whatsNew: WhatsNew = {
  count: 1,
  entry: {
    id: 'changelog_1',
    title: 'Faster search',
    excerpt: 'Search is faster.',
    publishedAt: '2026-11-20T10:00:00.000Z',
    date: 'Nov 20, 2026',
  },
  strings: {
    pill: '1 new update',
    action: "See what's new",
    dismiss: 'Dismiss',
    label: "What's new",
  },
}

const cardEl = () => document.querySelector('[data-quackback-reply-preview]') as HTMLElement | null
const shown = () => !!cardEl() && cardEl()!.style.display !== 'none'
const buttons = () => Array.from(cardEl()!.querySelectorAll('button'))
const dismissBtn = () => buttons().find((b) => b.getAttribute('aria-label') === 'Dismiss')!
const pillBtn = () => buttons().find((b) => b.textContent === 'Reply to Alex…')!
const bubbles = () => buttons().filter((b) => /^Reply \d/.test(b.textContent ?? ''))
const whatsNewShown = () => {
  const el = document.querySelector('[data-quackback-whats-new]') as HTMLElement | null
  return !!el && el.style.display !== 'none'
}

function stubMedia(match: (query: string) => boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: match(query),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

function clearStorage() {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}

describe('parseReplyPreview', () => {
  it('reads a well-formed payload', () => {
    expect(parseReplyPreview(sample())).toEqual(sample())
  })

  it('reads null, no messages or missing words as no card', () => {
    expect(parseReplyPreview(null)).toBeNull()
    expect(parseReplyPreview(sample({ messages: [] }))).toBeNull()
    expect(parseReplyPreview({ ...sample(), conversationId: '' })).toBeNull()
    expect(parseReplyPreview({ ...sample(), strings: { header: 'x' } })).toBeNull()
  })

  it('keeps the newest three replies, and an avatar only as an http(s) URL', () => {
    const parsed = parseReplyPreview(
      {
        ...sample({ messages: [msg(1), msg(2), msg(3), msg(4)] }),
        author: { name: 'Alex', firstName: 'Alex', avatarUrl: '/avatars/a.png' },
      },
      ORIGIN
    )!
    expect(parsed.messages.map((m) => m.id)).toEqual([
      'conversation_msg_2',
      'conversation_msg_3',
      'conversation_msg_4',
    ])
    expect(parsed.author.avatarUrl).toBe(`${ORIGIN}/avatars/a.png`)
    const script = parseReplyPreview(
      { ...sample(), author: { name: 'A', firstName: 'A', avatarUrl: 'javascript:alert(1)' } },
      ORIGIN
    )!
    expect(script.author.avatarUrl).toBeNull()
  })

  it('caps text between code points, longer when the whole reply shows', () => {
    const text = 'a'.repeat(399) + '\u{1F680}' + 'tail'
    const cut = parseReplyPreview(sample({ messages: [msg(1, text)] }))!
    expect(Array.from(cut.messages[0].text)).toHaveLength(400)
    expect(cut.messages[0].text.endsWith('\u{1F680}')).toBe(true)
    const full = parseReplyPreview(sample({ messages: [msg(1, text)], full: true }))!
    expect(full.messages[0].text).toBe(text)
  })

  it('makes initials by code point', () => {
    expect(initialsOf('Alex Kim')).toBe('AK')
    expect(initialsOf('ada')).toBe('A')
    expect(initialsOf('\u{1F98A} Fox')).toBe('\u{1F98A}F')
  })
})

describe('launcher reply preview', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stacks the replies, newest at the bottom beside the avatar, with the header and pill', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample({ messages: [msg(1), msg(2), msg(3)], count: 3 }))
    expect(shown()).toBe(true)
    expect(cardEl()!.textContent).toContain('Alex from Acme')
    expect(bubbles().map((b) => b.textContent)).toEqual(['Reply 1', 'Reply 2', 'Reply 3'])
    expect(pillBtn().querySelector('svg')).not.toBeNull()
    // The avatar sits outside the bubbles, initials on the brand colour.
    const avatar = cardEl()!.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(avatar.textContent).toBe('AK')
    expect(bubbles().some((b) => b.contains(avatar))).toBe(false)
    l.setColors({ backgroundColor: '#123456', foregroundColor: '#ffffff' })
    expect(avatar.style.backgroundColor).toBe('#123456')
    expect(avatar.style.color).toBe('#ffffff')
  })

  it('shows the photo when there is one, and initials if it fails to load', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(
      sample({
        author: { name: 'Alex Kim', firstName: 'Alex', avatarUrl: 'https://cdn.example.com/a.png' },
      })
    )
    const img = cardEl()!.querySelector('img') as HTMLImageElement
    expect(img.src).toBe('https://cdn.example.com/a.png')
    expect(img.alt).toBe('')
    img.dispatchEvent(new Event('error'))
    expect(cardEl()!.querySelector('img')).toBeNull()
    expect((cardEl()!.querySelector('span[aria-hidden="true"]') as HTMLElement).textContent).toBe(
      'AK'
    )
  })

  it('clamps each reply to four lines, unless the whole reply shows', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample())
    const text = () => bubbles()[0].firstElementChild as HTMLElement
    // Four lines of 1.4: a cap even where line clamping is unsupported.
    expect(text().style.maxHeight).toBe('5.6em')
    l.setReplyPreview(sample({ full: true }))
    expect(text().style.maxHeight).toBe('')
    expect(text().style.display).toBe('block')
  })

  it('opens the conversation from a bubble or the pill', () => {
    const onReplyOpen = vi.fn()
    const onClick = vi.fn()
    const l = createLauncher({ placement: 'right', onClick, onReplyOpen })
    l.setReplyPreview(sample())
    bubbles()[0].click()
    pillBtn().click()
    expect(onReplyOpen).toHaveBeenCalledTimes(2)
    expect(onReplyOpen).toHaveBeenCalledWith('conversation_1')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('dismisses with a 32px button, never opening, and the badge stays', () => {
    const onReplyOpen = vi.fn()
    const onReplyDismiss = vi.fn()
    const l = createLauncher({ placement: 'right', onClick: () => {}, onReplyOpen, onReplyDismiss })
    l.setUnread(2)
    l.setReplyPreview(sample())
    expect(dismissBtn().style.width).toBe('32px')
    expect(dismissBtn().style.height).toBe('32px')
    dismissBtn().click()
    expect(onReplyDismiss).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation_1' })
    )
    expect(onReplyOpen).not.toHaveBeenCalled()
    expect(shown()).toBe(false)
    const badge = l.el.lastElementChild as HTMLElement
    expect(badge.style.display).toBe('flex')
    expect(badge.textContent).toBe('2')
  })

  it('shows the dismiss button on hover or focus, and always on a touch screen', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample())
    expect(dismissBtn().style.opacity).toBe('0')
    cardEl()!.dispatchEvent(new MouseEvent('mouseenter'))
    expect(dismissBtn().style.opacity).toBe('1')
    cardEl()!.dispatchEvent(new MouseEvent('mouseleave'))
    expect(dismissBtn().style.opacity).toBe('0')
    pillBtn().focus()
    expect(dismissBtn().style.opacity).toBe('1')
    l.remove()

    document.body.innerHTML = ''
    stubMedia((q) => q.includes('hover: none'))
    const touch = createLauncher({ placement: 'right', onClick: () => {} })
    touch.setReplyPreview(sample())
    expect(dismissBtn().style.opacity).toBe('1')
  })

  it('Esc inside the card dismisses it and returns focus to the launcher', () => {
    const onReplyDismiss = vi.fn()
    const l = createLauncher({ placement: 'right', onClick: () => {}, onReplyDismiss })
    l.setReplyPreview(sample())
    pillBtn().focus()
    pillBtn().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onReplyDismiss).toHaveBeenCalled()
    expect(shown()).toBe(false)
    expect(document.activeElement).toBe(l.el)
  })

  it('on a phone spans the width and keeps the newest reply with the count', () => {
    stubMedia((q) => q.includes('max-width:639px'))
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(
      sample({
        messages: [msg(1), msg(2), msg(3)],
        count: 5,
        strings: { ...sample().strings, newReplies: '5 new replies' },
      })
    )
    expect(bubbles().map((b) => b.textContent)).toEqual(['Reply 3'])
    expect(cardEl()!.textContent).toContain('5 new replies')
    expect(cardEl()!.style.left).toContain('safe-area-inset-left')
    expect(cardEl()!.style.right).toContain('safe-area-inset-right')
    expect(cardEl()!.style.width).toBe('auto')
    expect(cardEl()!.style.bottom).toContain('safe-area-inset-bottom')
  })

  it('shows every reply and no count on a wider screen', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample())
    expect(bubbles()).toHaveLength(2)
    expect(cardEl()!.textContent).not.toContain('2 new replies')
    expect(cardEl()!.style.right).toContain('safe-area-inset-right')
    l.setPlacement('left')
    expect(cardEl()!.style.left).toContain('safe-area-inset-left')
  })

  it('goes ahead of the What’s new card and the greeting, which return after', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setGreeting('Need a hand?')
    l.setWhatsNew(whatsNew)
    expect(whatsNewShown()).toBe(true)
    l.setReplyPreview(sample())
    expect(shown()).toBe(true)
    expect(whatsNewShown()).toBe(false)
    const bubble = document.querySelector('body > div') as HTMLElement
    expect(bubble.style.display).toBe('none')
    dismissBtn().click()
    expect(whatsNewShown()).toBe(true)
  })

  it('waits for the reveal, and hides while open or hidden', () => {
    const l = createHiddenLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample())
    expect(shown()).toBe(false)
    l.reveal()
    expect(shown()).toBe(true)
    l.setOpen(true)
    expect(shown()).toBe(false)
    l.setOpen(false)
    l.setVisible(false)
    expect(shown()).toBe(false)
    l.setVisible(true)
    expect(shown()).toBe(true)
  })

  it('announces each new reply once, politely, outside the card', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const flush = () => frames.splice(0).forEach((cb) => cb(0))
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    const status = document.querySelector('[role="status"]') as HTMLElement
    l.setReplyPreview(sample())
    expect(cardEl()!.getAttribute('role')).toBe('region')
    expect(cardEl()!.contains(status)).toBe(false)
    flush()
    expect(status.textContent).toBe('New reply from Alex')
    l.setOpen(true)
    expect(status.textContent).toBe('')
    l.setOpen(false)
    flush()
    expect(status.textContent).toBe('')
    l.setReplyPreview(sample({ messages: [msg(1), msg(2), msg(3)], count: 3 }))
    flush()
    expect(status.textContent).toBe('New reply from Alex')
  })

  it('enters without motion when reduced motion is on', () => {
    stubMedia((q) => q.includes('prefers-reduced-motion'))
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample())
    expect(cardEl()!.style.transition).toBe('none')
    expect(cardEl()!.style.transform).toBe('')
  })

  it('goes with the launcher', () => {
    const l = createLauncher({ placement: 'right', onClick: () => {} })
    l.setReplyPreview(sample())
    l.remove()
    expect(cardEl()).toBeNull()
  })
})

describe('title alert', () => {
  let hidden = true
  beforeEach(() => {
    vi.useFakeTimers()
    hidden = true
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    document.title = 'Acme dashboard'
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (document as { visibilityState?: unknown }).visibilityState
  })
  const setVisible = (visible: boolean) => {
    hidden = !visible
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('alternates while the page is hidden and restores when it is visible', () => {
    const t = createTitleAlert()
    t.set('Alex replied')
    expect(document.title).toBe('Alex replied')
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS)
    expect(document.title).toBe('Acme dashboard')
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS)
    expect(document.title).toBe('Alex replied')
    setVisible(true)
    expect(document.title).toBe('Acme dashboard')
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS * 3)
    expect(document.title).toBe('Acme dashboard')
    t.destroy()
  })

  it('waits for the page to be hidden, and stops once the reply is read', () => {
    hidden = false
    const t = createTitleAlert()
    t.set('Alex replied')
    expect(document.title).toBe('Acme dashboard')
    setVisible(false)
    expect(document.title).toBe('Alex replied')
    t.set(null)
    expect(document.title).toBe('Acme dashboard')
    t.destroy()
  })

  it('keeps a title the page set itself', () => {
    const t = createTitleAlert()
    t.set('Alex replied')
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS)
    document.title = 'Inbox (3)'
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS)
    expect(document.title).toBe('Alex replied')
    setVisible(true)
    expect(document.title).toBe('Inbox (3)')
    t.destroy()
  })
})

describe('sdk reply preview', () => {
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
    ;(window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__ = { theme: {} }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (window as { __QUACKBACK_CONFIG__?: unknown }).__QUACKBACK_CONFIG__
  })

  function post(data: Record<string, unknown>) {
    window.dispatchEvent(new MessageEvent('message', { origin: ORIGIN, data }))
  }
  const preview = (replyPreview: unknown) => post({ type: 'quackback:reply-preview', replyPreview })

  function stubFrame() {
    const postMessage = vi.fn()
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
      postMessage,
    } as unknown as Window)
    return postMessage
  }

  it('shows the card and fires message once per reply, across page loads', () => {
    const first = createSDK()
    first.dispatch('init', { instanceUrl: ORIGIN })
    const handler = vi.fn()
    first.dispatch('on', 'message', handler)
    preview(sample())
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({
      conversationId: 'conversation_1',
      author: { name: 'Alex Kim', avatarUrl: null },
      preview: 'Reply 2',
    })
    preview(sample())
    expect(handler).toHaveBeenCalledTimes(2)
    first.dispatch('destroy')

    const second = createSDK()
    second.dispatch('init', { instanceUrl: ORIGIN })
    second.dispatch('on', 'message', handler)
    preview(sample({ messages: [msg(1), msg(2), msg(3)], count: 3 }))
    expect(handler).toHaveBeenCalledTimes(3)
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ preview: 'Reply 3' }))
    second.dispatch('destroy')
  })

  it('names a reply that shows as the team after the team', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    const handler = vi.fn()
    sdk.dispatch('on', 'message', handler)
    preview(sample({ author: { name: '', firstName: '', avatarUrl: null }, messages: [msg(1)] }))
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ author: { name: 'Acme', avatarUrl: null } })
    )
    sdk.dispatch('destroy')
  })

  it('opens the widget on the conversation with focus moved in, and stays answered', () => {
    const postMessage = stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:ready' })
    const onOpen = vi.fn()
    sdk.dispatch('on', 'open', onOpen)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    preview(sample())
    pillBtn().click()
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'quackback:open', data: { view: 'messages', conversationId: 'conversation_1' } },
      ORIGIN
    )
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'messages', conversationId: 'conversation_1' })
    )
    frames.splice(0).forEach((cb) => cb(0))
    expect(document.activeElement).toBe(document.querySelector('iframe'))
    sdk.dispatch('close')
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('remembers a dismiss until a newer reply, without touching the badge', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:unread', count: 2, messages: 2, changelog: 0, tickets: 0 })
    preview(sample())
    dismissBtn().click()
    expect(shown()).toBe(false)
    const stored = JSON.parse(localStorage.getItem(`quackback:reply-preview:${ORIGIN}:anon`)!)
    expect(stored.answered).toEqual(['conversation_msg_1', 'conversation_msg_2'])
    const btn = document.querySelector('button[aria-label^="Open help"]') as HTMLElement
    expect(btn.getAttribute('aria-label')).toBe('Open help, 2 unread')
    sdk.dispatch('destroy')

    const again = createSDK()
    again.dispatch('init', { instanceUrl: ORIGIN })
    preview(sample())
    expect(shown()).toBe(false)
    preview(sample({ messages: [msg(1), msg(2), msg(3)], count: 3 }))
    expect(shown()).toBe(true)
    again.dispatch('destroy')
  })

  it('bounds the remembered replies', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    for (let i = 0; i < 40; i++) {
      preview(
        sample({
          messages: [
            { id: `m_${i}a`, text: 'a', createdAt: '' },
            { id: `m_${i}b`, text: 'b', createdAt: '' },
          ],
        })
      )
      if (shown()) dismissBtn().click()
    }
    const stored = JSON.parse(localStorage.getItem(`quackback:reply-preview:${ORIGIN}:anon`)!)
    expect(stored.answered.length).toBeLessThanOrEqual(50)
    expect(stored.announced.length).toBeLessThanOrEqual(50)
    sdk.dispatch('destroy')
  })

  const userA = { id: 'user_a', name: 'Ada', email: 'ada@example.com' }
  const resolved = (user: typeof userA | null) =>
    post({ type: 'quackback:identify-result', success: true, user })

  it('waits for a new identity and drops the previous visitor’s replies', () => {
    stubFrame()
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:ready' })
    const handler = vi.fn()
    sdk.dispatch('on', 'message', handler)
    preview(sample())
    expect(handler).toHaveBeenCalledTimes(2)
    sdk.dispatch('identify', { ssoToken: 'token-a' })
    expect(shown()).toBe(false)
    preview(sample({ messages: [msg(5)], count: 1 }))
    // Still waiting: nothing shows or fires under the wrong visitor.
    expect(shown()).toBe(false)
    expect(handler).toHaveBeenCalledTimes(2)
    resolved(userA)
    expect(shown()).toBe(false)
    preview(sample({ messages: [msg(5)], count: 1 }))
    expect(shown()).toBe(true)
    expect(handler).toHaveBeenCalledTimes(3)
    sdk.dispatch('logout')
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('hides the card when another tab dismisses it', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    preview(sample())
    const key = `quackback:reply-preview:${ORIGIN}:anon`
    localStorage.setItem(key, JSON.stringify({ answered: ['conversation_msg_2'], announced: [] }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(shown()).toBe(true)
    window.dispatchEvent(new StorageEvent('storage', { key }))
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('fires message without a launcher, and a launcher shown later carries the card', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN, launcher: false })
    const handler = vi.fn()
    sdk.dispatch('on', 'message', handler)
    preview(sample())
    expect(handler).toHaveBeenCalledTimes(2)
    expect(cardEl()).toBeNull()
    sdk.dispatch('showLauncher')
    expect(shown()).toBe(true)
    sdk.dispatch('hideLauncher')
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
    expect(cardEl()).toBeNull()
  })

  it('clears the card on null or a malformed payload', () => {
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    preview(sample())
    preview(null)
    expect(shown()).toBe(false)
    preview(sample())
    preview({ conversationId: 7 })
    expect(shown()).toBe(false)
    sdk.dispatch('destroy')
  })

  it('flashes the tab title from the frame while hidden, and restores it', () => {
    vi.useFakeTimers()
    let hidden = true
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    document.title = 'Acme dashboard'
    const sdk = createSDK()
    sdk.dispatch('init', { instanceUrl: ORIGIN })
    post({ type: 'quackback:title-alert', text: 'Alex replied' })
    expect(document.title).toBe('Alex replied')
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS)
    expect(document.title).toBe('Acme dashboard')
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS)
    post({ type: 'quackback:title-alert', text: null })
    expect(document.title).toBe('Acme dashboard')
    post({ type: 'quackback:title-alert', text: 'Alex replied' })
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('Acme dashboard')
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('Alex replied')
    sdk.dispatch('destroy')
    expect(document.title).toBe('Acme dashboard')
    vi.useRealTimers()
    delete (document as { visibilityState?: unknown }).visibilityState
  })
})
