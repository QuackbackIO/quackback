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
  /** Unread replies in the conversation; may exceed `messages`. */
  count: number
  /** Show each reply whole, without the four-line clamp. */
  full: boolean
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

const MAX_MESSAGES = 3

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
        text: str(o.text, full ? 2000 : 400),
        createdAt: str(o.createdAt, 64),
      }
    })
    .filter((m) => m.id && m.text)
  const parsed: ReplyPreview = {
    conversationId: str(r.conversationId, 128),
    author: {
      name: str(author.name, 120),
      firstName: str(author.firstName, 120),
      avatarUrl: avatarUrl(author.avatarUrl, base),
    },
    teamName: str(r.teamName, 120),
    messages,
    count: typeof r.count === 'number' && r.count > 0 ? Math.floor(r.count) : messages.length,
    full,
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
const SHADOW = '0 8px 24px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.10)'
const AVATAR = 32
const SEND_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z"/></svg>'

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
    width: '320px',
    fontFamily: FONT,
    fontSize: '14px',
    lineHeight: '1.4',
    color: '#111827',
    textAlign: 'start',
  })

  const head = document.createElement('div')
  Object.assign(head.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingInlineStart: `${AVATAR + 8}px`,
  })
  const header = document.createElement('span')
  Object.assign(header.style, {
    minWidth: '0',
    padding: '3px 10px',
    borderRadius: '999px',
    backgroundColor: '#ffffff',
    color: '#4b5563',
    fontSize: '12px',
    fontWeight: '600',
    boxShadow: SHADOW,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  const headerName = document.createElement('span')
  const headerCount = document.createElement('span')
  Object.assign(headerCount.style, { marginInlineStart: '6px', color: '#111827' })
  header.append(headerName, headerCount)
  const spacer = document.createElement('span')
  spacer.style.flex = '1'
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = '×'
  Object.assign(dismiss.style, {
    flexShrink: '0',
    width: '32px',
    height: '32px',
    padding: '0',
    border: 'none',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    color: '#4b5563',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    boxShadow: SHADOW,
    transition: 'opacity 150ms ease',
  })
  head.append(header, spacer, dismiss)

  const body = document.createElement('div')
  Object.assign(body.style, { display: 'flex', alignItems: 'flex-end', gap: '8px' })
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
    fontWeight: '700',
    boxShadow: SHADOW,
  })
  const stack = document.createElement('div')
  Object.assign(stack.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    minWidth: '0',
    flex: '1',
  })
  body.append(avatar, stack)

  const pill = document.createElement('button')
  pill.type = 'button'
  Object.assign(pill.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginInlineStart: `${AVATAR + 8}px`,
    padding: '9px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: '999px',
    backgroundColor: '#ffffff',
    color: '#6b7280',
    fontFamily: FONT,
    fontSize: '14px',
    textAlign: 'start',
    cursor: 'pointer',
    boxShadow: SHADOW,
  })
  const pillText = document.createElement('span')
  Object.assign(pillText.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  const pillIcon = document.createElement('span')
  Object.assign(pillIcon.style, { display: 'flex', flexShrink: '0', color: '#111827' })
  pillIcon.innerHTML = SEND_ICON
  pill.append(pillText, pillIcon)

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
      card.style.width = '320px'
      card.style.maxWidth = opts.contained ? 'calc(100% - 16px)' : 'calc(100vw - 48px)'
    }
  }
  const onPhoneChange = () => {
    place()
    if (current) fill(current)
  }
  place()
  phoneMql?.addEventListener?.('change', onPhoneChange)

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

  function bubble(text: string, full: boolean, newest: boolean): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    Object.assign(b.style, {
      maxWidth: '100%',
      padding: '9px 12px',
      border: 'none',
      borderRadius: newest ? '14px 14px 14px 4px' : '14px',
      backgroundColor: '#ffffff',
      color: '#111827',
      fontFamily: FONT,
      fontSize: '14px',
      lineHeight: '1.4',
      textAlign: 'start',
      cursor: 'pointer',
      boxShadow: SHADOW,
    })
    const t = document.createElement('span')
    Object.assign(t.style, {
      display: full ? 'block' : '-webkit-box',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      overflow: 'hidden',
    })
    if (!full) {
      // Four lines; the height caps it where line clamping is unsupported.
      t.style.maxHeight = '5.6em'
      t.style.setProperty('-webkit-line-clamp', '4')
      t.style.setProperty('-webkit-box-orient', 'vertical')
    }
    t.textContent = text
    b.appendChild(t)
    b.addEventListener('click', open)
    return b
  }

  function fill(data: ReplyPreview): void {
    const collapse = phone() && data.messages.length > 1
    const shownMessages = collapse ? data.messages.slice(-1) : data.messages
    card.setAttribute('aria-label', data.strings.label || data.strings.header)
    headerName.textContent = data.strings.header
    const showCount = phone() && data.count > 1 && !!data.strings.newReplies
    headerCount.textContent = showCount ? data.strings.newReplies : ''
    headerCount.style.display = showCount ? 'inline' : 'none'
    dismiss.setAttribute('aria-label', data.strings.dismiss)
    pillText.textContent = data.strings.replyTo
    stack.textContent = ''
    shownMessages.forEach((m, i) =>
      stack.appendChild(bubble(m.text, data.full, i === shownMessages.length - 1))
    )
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
      current = data
      if (!data) {
        card.style.display = 'none'
        shownId = null
        return
      }
      fill(data)
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
