/**
 * The "What's new" card above the closed launcher: the newest changelog entry
 * the visitor has not seen, sent by the frame as `quackback:whats-new`. The
 * frame localises every string it shows, so this module holds no copy.
 */

export interface WhatsNew {
  /** Unread changelog entries. */
  count: number
  entry: {
    id: string
    title: string
    /** Plain text, already cut at a word by the frame. */
    excerpt: string
    /** ISO timestamp. */
    publishedAt: string
    /** The publish date as the visitor reads it, e.g. "Nov 20, 2026". */
    date: string
  }
  strings: {
    /** The count pill, e.g. "2 new updates". */
    pill: string
    /** The action, e.g. "See what's new". */
    action: string
    /** The dismiss button's accessible name. */
    dismiss: string
    /** The card's accessible name, e.g. "What's new". */
    label: string
  }
}

/** Trimmed text of at most `max` characters, cut between code points so an
 *  emoji is never split. */
const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? Array.from(v.trim()).slice(0, max).join('').trim() : ''

/** Read a frame payload defensively; anything malformed reads as no card. */
export function parseWhatsNew(raw: unknown): WhatsNew | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { count?: unknown; entry?: unknown; strings?: unknown }
  const entry = (r.entry ?? {}) as Record<string, unknown>
  const strings = (r.strings ?? {}) as Record<string, unknown>
  const count = typeof r.count === 'number' && r.count > 0 ? Math.floor(r.count) : 0
  const parsed: WhatsNew = {
    count,
    entry: {
      id: str(entry.id, 128),
      title: str(entry.title, 200),
      excerpt: str(entry.excerpt, 400),
      publishedAt: str(entry.publishedAt, 64),
      date: str(entry.date, 64),
    },
    strings: {
      pill: str(strings.pill, 64),
      action: str(strings.action, 64),
      dismiss: str(strings.dismiss, 64),
      label: str(strings.label, 64),
    },
  }
  const { entry: e, strings: s } = parsed
  if (!count || !e.id || !e.title || !s.pill || !s.action || !s.dismiss) return null
  return parsed
}

export interface WhatsNewCardOptions {
  mount: HTMLElement
  side: 'left' | 'right'
  /** Inside the admin preview: absolute, no phone layout. */
  contained: boolean
  /** Read live: the visitor can change the setting while the page is open. */
  reduceMotion: () => boolean
  /** Offsets shared with the launcher's greeting bubble. */
  sideEdge: (side: 'left' | 'right') => string
  bottom: string
  onOpen: (entryId: string) => void
  onDismiss: (entryId: string) => void
  /** The card appeared, or now shows a different entry. */
  onShown: (data: WhatsNew) => void
}

export interface WhatsNewCardHandle {
  el: HTMLElement
  /** Show `data`, or hide the card when null. */
  render(data: WhatsNew | null): void
  setSide(side: 'left' | 'right'): void
  setAccent(colors: { backgroundColor: string; foregroundColor: string }): void
  /** Re-read the reduced-motion setting. */
  applyMotion(): void
  remove(): void
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
/** Same rule as the full-screen panel: a phone spans the card edge to edge. */
const PHONE_QUERY = '(max-width: 639px)'
const PHONE_MARGIN = '16px'

export function createWhatsNewCard(opts: WhatsNewCardOptions): WhatsNewCardHandle {
  let side = opts.side
  let current: WhatsNew | null = null
  // The entrance plays once per entry, not on every reopen of the launcher.
  let enteredId: string | null = null
  let shownId: string | null = null

  const card = document.createElement('div')
  card.setAttribute('role', 'region')
  card.setAttribute('data-quackback-whats-new', '')
  Object.assign(card.style, {
    position: opts.contained ? 'absolute' : 'fixed',
    bottom: opts.bottom,
    zIndex: '2147483646',
    display: 'none',
    flexDirection: 'column',
    gap: '6px',
    boxSizing: 'border-box',
    width: '320px',
    maxWidth: '320px',
    padding: '12px 12px 12px 14px',
    borderRadius: '14px',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: '13px',
    lineHeight: '1.4',
    fontFamily: FONT,
    textAlign: 'start',
    cursor: 'pointer',
    boxShadow: '0 12px 32px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
  })

  const top = document.createElement('div')
  Object.assign(top.style, { display: 'flex', alignItems: 'center', gap: '8px' })
  const pill = document.createElement('span')
  Object.assign(pill.style, {
    padding: '2px 8px',
    borderRadius: '999px',
    backgroundColor: '#000000',
    color: '#facc15',
    fontSize: '11px',
    fontWeight: '700',
    lineHeight: '1.5',
    whiteSpace: 'nowrap',
  })
  const spacer = document.createElement('span')
  spacer.style.flex = '1'
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = '×'
  Object.assign(dismiss.style, {
    flexShrink: '0',
    width: '32px',
    height: '32px',
    margin: '-8px -6px -8px 0',
    padding: '0',
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: '#6b7280',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
  })
  top.append(pill, spacer, dismiss)

  const title = document.createElement('div')
  Object.assign(title.style, {
    fontSize: '14px',
    fontWeight: '600',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })

  const excerpt = document.createElement('div')
  Object.assign(excerpt.style, {
    color: '#4b5563',
    display: '-webkit-box',
    webkitLineClamp: '2',
    webkitBoxOrient: 'vertical',
    overflow: 'hidden',
  })

  const foot = document.createElement('div')
  Object.assign(foot.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginTop: '2px',
  })
  const action = document.createElement('button')
  action.type = 'button'
  Object.assign(action.style, {
    padding: '0',
    border: 'none',
    background: 'transparent',
    color: '#111827',
    fontFamily: FONT,
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  })
  const date = document.createElement('time')
  Object.assign(date.style, { color: '#6b7280', fontSize: '12px', whiteSpace: 'nowrap' })
  foot.append(action, date)

  card.append(top, title, excerpt, foot)
  opts.mount.appendChild(card)

  // The card is one target; the action button is its keyboard entry point.
  card.addEventListener('click', () => {
    if (current) opts.onOpen(current.entry.id)
  })
  const doDismiss = () => {
    if (current) opts.onDismiss(current.entry.id)
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

  const phoneMql =
    !opts.contained && typeof window.matchMedia === 'function'
      ? window.matchMedia(PHONE_QUERY)
      : null
  const place = () => {
    const phone = !!phoneMql?.matches
    if (phone) {
      // Spans the screen less the side margins, clear of a notch either side.
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
  place()
  phoneMql?.addEventListener?.('change', place)

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
      card.setAttribute('aria-label', data.strings.label || data.strings.action)
      pill.textContent = data.strings.pill
      title.textContent = data.entry.title
      excerpt.textContent = data.entry.excerpt
      excerpt.style.display = data.entry.excerpt ? '-webkit-box' : 'none'
      action.textContent = data.strings.action
      dismiss.setAttribute('aria-label', data.strings.dismiss)
      date.textContent = data.entry.date
      date.dateTime = data.entry.publishedAt
      const appearing = card.style.display === 'none'
      card.style.display = 'flex'
      if (appearing && enteredId !== data.entry.id) enter()
      enteredId = data.entry.id
      if (shownId !== data.entry.id) {
        shownId = data.entry.id
        opts.onShown(data)
      }
    },
    setSide(next) {
      side = next
      place()
    },
    applyMotion,
    setAccent({ backgroundColor, foregroundColor }) {
      pill.style.backgroundColor = backgroundColor
      pill.style.color = foregroundColor
    },
    remove() {
      phoneMql?.removeEventListener?.('change', place)
      card.remove()
    },
  }
}
