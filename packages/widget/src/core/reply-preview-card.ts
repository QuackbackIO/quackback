import { FULL_SCREEN_MEDIA } from './style'

/**
 * The reply preview above the closed launcher: the newest unread replies of
 * the visitor's most recent conversation, sent by the frame as
 * `quackback:reply-preview`. The frame localises every string it shows, so
 * this module holds no copy.
 */

export interface ReplyPreview {
  conversationId: string
  author: {
    /** Empty when the reply shows as the team. */
    name: string
    firstName: string
    /** An absolute http(s) URL, or null for initials. */
    avatarUrl: string | null
  }
  teamName: string
  /** Oldest first, at most three. Plain text, already cut by the frame
   *  unless `full`. */
  messages: Array<{ id: string; text: string; createdAt: string }>
  /** Every new unread reply across the visitor's conversations, oldest
   *  first, at most 20, each with its author: the message event reports
   *  each once. Empty from a frame that predates it. */
  recent: Array<{
    id: string
    conversationId: string
    author: { name: string; avatarUrl: string | null }
    text: string
  }>
  /** Unread replies in the conversation; may exceed `messages`. */
  count: number
  /** Show the card above the launcher. Off when the workspace shows the
   *  badge only: the replies still drive the message event and tab title. */
  card: boolean
  /** Show each reply whole, without the four-line clamp. */
  full: boolean
  /** The tab title flash, e.g. "Alex replied", or null when that is off. */
  title: string | null
  strings: {
    /** e.g. "Alex from Acme". */
    header: string
    /** e.g. "Reply to Alex…". */
    replyTo: string
    /** e.g. "3 new replies". */
    newReplies: string
    /** The dismiss button's accessible name. */
    dismiss: string
    /** The card's accessible name. */
    label: string
    /** Said once per new reply, e.g. "New reply from Alex". */
    announce: string
  }
}

/** Trimmed text of at most `max` characters, cut between code points. */
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? Array.from(v.trim()).slice(0, max).join('').trim() : ''

/** Message text of at most `max` code points, ending in an ellipsis when
 *  cut, so a shortened reply never reads as whole. */
const text = (v: unknown, max: number): string => {
  const chars = typeof v === 'string' ? Array.from(v.trim()) : []
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

const MAX_MESSAGES = 3
const MAX_RECENT = 20

/** An http(s) avatar URL, resolved against the instance; anything else is
 *  dropped, as it renders in the host page. */
function avatarUrl(v: unknown, base: string | undefined): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  try {
    const u = new URL(v.trim(), base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** Read a frame payload defensively; anything malformed reads as no card. */
export function parseReplyPreview(raw: unknown, base?: string): ReplyPreview | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const author = (r.author ?? {}) as Record<string, unknown>
  const strings = (r.strings ?? {}) as Record<string, unknown>
  const full = r.full === true
  const messages = (Array.isArray(r.messages) ? r.messages : [])
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>
      return {
        id: str(o.id, 128),
        text: text(o.text, full ? 2000 : 400),
        createdAt: str(o.createdAt, 64),
      }
    })
    .filter((m) => m.id && m.text)
  const recent = (Array.isArray(r.recent) ? r.recent : [])
    .slice(-MAX_RECENT)
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>
      const a = (o.author ?? {}) as Record<string, unknown>
      return {
        id: str(o.id, 128),
        conversationId: str(o.conversationId, 128),
        author: { name: str(a.name, 120), avatarUrl: avatarUrl(a.avatarUrl, base) },
        text: text(o.text, 280),
      }
    })
    .filter((m) => m.id && m.conversationId)
  const parsed: ReplyPreview = {
    conversationId: str(r.conversationId, 128),
    author: {
      name: str(author.name, 120),
      firstName: str(author.firstName, 120),
      avatarUrl: avatarUrl(author.avatarUrl, base),
    },
    teamName: str(r.teamName, 120),
    messages,
    recent,
    count: typeof r.count === 'number' && r.count > 0 ? Math.floor(r.count) : messages.length,
    // A frame that sends no flag predates the badge-only setting: a card.
    card: r.card !== false,
    full,
    title: str(r.title, 160) || null,
    strings: {
      header: str(strings.header, 160),
      replyTo: str(strings.replyTo, 160),
      newReplies: str(strings.newReplies, 64),
      dismiss: str(strings.dismiss, 64),
      label: str(strings.label, 160),
      announce: str(strings.announce, 160),
    },
  }
  const s = parsed.strings
  if (!parsed.conversationId || messages.length === 0) return null
  if (!s.header || !s.replyTo || !s.dismiss || !s.announce) return null
  return parsed
}

/** Up to two initials, by code point, for an avatar without a photo. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = (w: string | undefined) => (w ? (Array.from(w)[0] ?? '') : '')
  const letters =
    words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0])
  return letters.toUpperCase()
}

export interface ReplyPreviewCardOptions {
  mount: HTMLElement
  side: 'left' | 'right'
  /** Inside the admin preview: absolute, no phone layout. */
  contained: boolean
  /** Read live: the visitor can change the setting while the page is open. */
  reduceMotion: () => boolean
  /** Offsets shared with the launcher's greeting bubble. */
  sideEdge: (side: 'left' | 'right') => string
  bottom: string
  onOpen: (conversationId: string) => void
  onDismiss: (data: ReplyPreview) => void
  /** The card appeared, or now shows a newer reply. */
  onShown: (data: ReplyPreview) => void
}

export interface ReplyPreviewCardHandle {
  el: HTMLElement
  /** Show `data`, or hide the card when null. */
  render(data: ReplyPreview | null): void
  setSide(side: 'left' | 'right'): void
  /** The brand colours, for initials. */
  setAccent(colors: { backgroundColor: string; foregroundColor: string }): void
  /** Re-read the reduced-motion setting. */
  applyMotion(): void
  remove(): void
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const PHONE_MARGIN = '16px'
/** The card column on wider screens. */
const WIDTH = '348px'
const AVATAR = 32
const GAP = 8
const INK = '#0f172a'
const MUTED = '#64748b'
const BUBBLE_SHADOW = '0 8px 24px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.08)'
const SOFT_SHADOW = '0 4px 14px rgba(15,23,42,0.08)'
const UP_ARROW =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clip-rule="evenodd"/></svg>'

const media = (query: string): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia(query) : null

export function createReplyPreviewCard(opts: ReplyPreviewCardOptions): ReplyPreviewCardHandle {
  let side = opts.side
  let current: ReplyPreview | null = null
  let accent = { backgroundColor: '#000000', foregroundColor: '#facc15' }
  // The entrance plays once per newest reply, not on every reopen.
  let enteredId: string | null = null
  let shownId: string | null = null

  const card = document.createElement('div')
  card.setAttribute('role', 'region')
  card.setAttribute('data-quackback-reply-preview', '')
  Object.assign(card.style, {
    position: opts.contained ? 'absolute' : 'fixed',
    bottom: opts.bottom,
    zIndex: '2147483646',
    display: 'none',
    flexDirection: 'column',
    gap: '6px',
    boxSizing: 'border-box',
    width: WIDTH,
    fontFamily: FONT,
    fontSize: '14px',
    lineHeight: '1.45',
    color: INK,
    textAlign: 'start',
  })

  // The dismiss button sits above the stack at the right.
  const head = document.createElement('div')
  Object.assign(head.style, { display: 'flex', justifyContent: 'flex-end' })
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = '×'
  Object.assign(dismiss.style, {
    width: '32px',
    height: '32px',
    padding: '0',
    border: '1px solid rgba(15,23,42,0.08)',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    color: MUTED,
    fontSize: '18px',
    lineHeight: '1',
    cursor: 'pointer',
    boxShadow: SOFT_SHADOW,
    transition: 'opacity 150ms ease',
  })
  head.append(dismiss)

  // The avatar sits outside the bubbles, level with the newest one.
  const body = document.createElement('div')
  Object.assign(body.style, { display: 'flex', alignItems: 'flex-end', gap: `${GAP}px` })
  const avatar = document.createElement('span')
  avatar.setAttribute('aria-hidden', 'true')
  Object.assign(avatar.style, {
    flexShrink: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${AVATAR}px`,
    height: `${AVATAR}px`,
    borderRadius: '50%',
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: '600',
  })
  const stack = document.createElement('div')
  Object.assign(stack.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '6px',
    minWidth: '0',
    flex: '1',
  })
  body.append(avatar, stack)

  // The header, drawn inside the first bubble: the first name in ink, the
  // rest muted, and on phones the number of new replies at the right.
  const header = document.createElement('span')
  header.setAttribute('data-reply-header', '')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '3px',
    fontSize: '12.5px',
    lineHeight: '1.3',
    color: MUTED,
  })
  const headerText = document.createElement('span')
  Object.assign(headerText.style, {
    flex: '1',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  const headerCount = document.createElement('span')
  Object.assign(headerCount.style, { flexShrink: '0', fontWeight: '600' })
  header.append(headerText, headerCount)

  const pill = document.createElement('button')
  pill.type = 'button'
  Object.assign(pill.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    boxSizing: 'border-box',
    height: '42px',
    marginInlineStart: `${AVATAR + GAP}px`,
    padding: '0 5px 0 16px',
    border: '1px solid #e2e8f0',
    borderRadius: '21px',
    backgroundColor: '#ffffff',
    color: MUTED,
    fontFamily: FONT,
    fontSize: '14px',
    textAlign: 'start',
    cursor: 'pointer',
    boxShadow: SOFT_SHADOW,
  })
  const pillText = document.createElement('span')
  Object.assign(pillText.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  const send = document.createElement('span')
  send.setAttribute('data-reply-send', '')
  Object.assign(send.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    color: '#ffffff',
  })
  send.innerHTML = UP_ARROW
  pill.append(pillText, send)

  card.append(head, body, pill)
  opts.mount.appendChild(card)

  const open = () => {
    if (current) opts.onOpen(current.conversationId)
  }
  pill.addEventListener('click', open)
  const doDismiss = () => {
    if (current) opts.onDismiss(current)
  }
  dismiss.addEventListener('click', (e) => {
    e.stopPropagation()
    doDismiss()
  })
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    doDismiss()
  })

  // The dismiss button shows on hover or keyboard focus, and always on a
  // touch screen, which has no hover.
  const touchMql = opts.contained ? null : media('(hover: none)')
  let hovering = false
  const showDismiss = () => {
    const on = !!touchMql?.matches || hovering || card.contains(document.activeElement)
    dismiss.style.opacity = on ? '1' : '0'
  }
  card.addEventListener('mouseenter', () => {
    hovering = true
    showDismiss()
  })
  card.addEventListener('mouseleave', () => {
    hovering = false
    showDismiss()
  })
  card.addEventListener('focusin', showDismiss)
  card.addEventListener('focusout', () => requestAnimationFrame(showDismiss))
  touchMql?.addEventListener?.('change', showDismiss)

  // Phones (where the panel fills the screen) span the card edge to edge and
  // keep only the newest reply.
  const phoneMql = opts.contained ? null : media(FULL_SCREEN_MEDIA)
  const phone = () => !!phoneMql?.matches
  const place = () => {
    if (phone()) {
      card.style.left = `calc(${PHONE_MARGIN} + env(safe-area-inset-left, 0px))`
      card.style.right = `calc(${PHONE_MARGIN} + env(safe-area-inset-right, 0px))`
      card.style.width = 'auto'
      card.style.maxWidth = 'none'
    } else {
      card.style.left = side === 'left' ? opts.sideEdge('left') : ''
      card.style.right = side === 'right' ? opts.sideEdge('right') : ''
      card.style.width = WIDTH
      card.style.maxWidth = opts.contained ? 'calc(100% - 16px)' : 'calc(100vw - 48px)'
    }
  }
  const onPhoneChange = () => {
    place()
    if (current) fill(current)
  }
  place()
  phoneMql?.addEventListener?.('change', onPhoneChange)

  /** The brand colour on the send button and the count of new replies. */
  function paintAccent(): void {
    send.style.backgroundColor = accent.backgroundColor
    headerCount.style.color = accent.backgroundColor
  }
  paintAccent()

  function paintAvatar(data: ReplyPreview): void {
    avatar.textContent = ''
    avatar.style.backgroundColor = accent.backgroundColor
    avatar.style.color = accent.foregroundColor
    const initials = () => {
      avatar.textContent = initialsOf(data.author.name || data.teamName)
    }
    if (!data.author.avatarUrl) return initials()
    const img = document.createElement('img')
    img.alt = ''
    img.src = data.author.avatarUrl
    Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover' })
    img.addEventListener('error', () => {
      img.remove()
      initials()
    })
    avatar.appendChild(img)
  }

  /** The header's words, with the first name in ink wherever the visitor's
   *  language puts it. */
  function paintHeader(data: ReplyPreview): void {
    const words = data.strings.header
    const name = data.author.firstName
    const at = name ? words.indexOf(name) : -1
    headerText.textContent = ''
    if (at < 0) {
      headerText.textContent = words
      return
    }
    const strong = document.createElement('span')
    Object.assign(strong.style, { fontWeight: '600', color: INK })
    strong.textContent = name
    headerText.append(words.slice(0, at), strong, words.slice(at + name.length))
  }

  function bubble(text: string, full: boolean, newest: boolean): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('data-reply-bubble', '')
    Object.assign(b.style, {
      display: 'block',
      boxSizing: 'border-box',
      width: '100%',
      padding: '11px 14px 12px',
      border: '1px solid rgba(15,23,42,0.06)',
      borderRadius: newest ? '16px 16px 16px 6px' : '16px',
      backgroundColor: '#ffffff',
      color: INK,
      fontFamily: FONT,
      fontSize: '14px',
      lineHeight: '1.45',
      textAlign: 'start',
      cursor: 'pointer',
      boxShadow: BUBBLE_SHADOW,
    })
    const t = document.createElement('span')
    t.setAttribute('data-reply-text', '')
    Object.assign(t.style, {
      display: full ? 'block' : '-webkit-box',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      overflow: 'hidden',
    })
    if (!full) {
      // Four lines of 1.45; the height caps it where clamping is unsupported.
      t.style.maxHeight = '5.8em'
      t.style.setProperty('-webkit-line-clamp', '4')
      t.style.setProperty('-webkit-box-orient', 'vertical')
    }
    t.textContent = text
    b.appendChild(t)
    b.addEventListener('click', open)
    return b
  }

  // The layout the bubbles were last built for.
  let filledPhone: boolean | null = null
  function fill(data: ReplyPreview): void {
    filledPhone = phone()
    const collapse = phone() && data.messages.length > 1
    const shownMessages = collapse ? data.messages.slice(-1) : data.messages
    card.setAttribute('aria-label', data.strings.label || data.strings.header)
    paintHeader(data)
    const showCount = phone() && data.count > 1 && !!data.strings.newReplies
    headerCount.textContent = showCount ? data.strings.newReplies : ''
    headerCount.style.display = showCount ? 'inline' : 'none'
    dismiss.setAttribute('aria-label', data.strings.dismiss)
    pillText.textContent = data.strings.replyTo
    stack.textContent = ''
    shownMessages.forEach((m, i) => {
      const b = bubble(m.text, data.full, i === shownMessages.length - 1)
      // The header opens the first bubble shown.
      if (i === 0) b.prepend(header)
      stack.appendChild(b)
    })
    // A whole long reply scrolls inside the card rather than off the screen.
    stack.style.maxHeight = data.full ? 'min(60vh, 480px)' : ''
    stack.style.overflowY = data.full ? 'auto' : ''
    paintAvatar(data)
    showDismiss()
  }

  function applyMotion(): void {
    const reduce = opts.reduceMotion()
    card.style.transition = reduce ? 'none' : 'opacity 220ms ease, transform 220ms ease'
    if (reduce) {
      card.style.opacity = ''
      card.style.transform = ''
    }
  }
  applyMotion()

  const enter = () => {
    if (opts.reduceMotion()) return
    card.style.opacity = '0'
    card.style.transform = 'translateY(8px)'
    requestAnimationFrame(() => {
      card.style.opacity = '1'
      card.style.transform = 'translateY(0)'
    })
  }

  return {
    el: card,
    render(data) {
      const unchanged = data === current && filledPhone === phone()
      current = data
      if (!data) {
        card.style.display = 'none'
        shownId = null
        return
      }
      // The same payload again keeps the bubbles, and the focus in them.
      if (!unchanged) fill(data)
      const newestId = data.messages[data.messages.length - 1].id
      const appearing = card.style.display === 'none'
      card.style.display = 'flex'
      if (appearing && enteredId !== newestId) enter()
      enteredId = newestId
      if (shownId !== newestId) {
        shownId = newestId
        opts.onShown(data)
      }
    },
    setSide(next) {
      side = next
      place()
    },
    setAccent(colors) {
      accent = colors
      paintAccent()
      if (current) paintAvatar(current)
    },
    applyMotion,
    remove() {
      phoneMql?.removeEventListener?.('change', onPhoneChange)
      touchMql?.removeEventListener?.('change', showDismiss)
      card.remove()
    },
  }
}
