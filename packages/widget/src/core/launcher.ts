import { launcherLabels } from './labels'
import { createWhatsNewCard, type WhatsNew, type WhatsNewCardHandle } from './whats-new-card'

export interface LauncherOptions {
  placement: 'left' | 'right'
  onClick: () => void
  /**
   * Mount the button (and greeting) inside this element with absolute
   * positioning. Used by the admin live preview so the real launcher sits in
   * the fake page instead of `position: fixed` on the viewport.
   */
  root?: HTMLElement
  /** The visitor's language, for the button's accessible name. */
  locale?: string
  /** The "What's new" card was clicked: open the widget on this entry. */
  onWhatsNewOpen?: (entryId: string) => void
  /** The "What's new" card was dismissed for this entry. */
  onWhatsNewDismiss?: (entryId: string) => void
  /** The "What's new" card appeared for an entry it had not shown yet. */
  onWhatsNewShown?: (data: WhatsNew) => void
}

export interface LauncherHandle {
  el: HTMLButtonElement
  setOpen(open: boolean): void
  /** Show or hide the button together with its greeting bubble. */
  setVisible(visible: boolean): void
  /** Replace the button colors (typically called after server config fetch). */
  setColors(colors: { backgroundColor?: string; foregroundColor?: string }): void
  /** Show an unread-count badge on the button (hidden at 0). Driven by the
   *  iframe's `quackback:unread` messages so a visitor sees waiting replies
   *  without opening the widget. */
  setUnread(count: number): void
  /** Proactive greeting bubble beside the button (empty/unset hides it). Shown
   *  only while closed and not dismissed this browser session; clicking it opens
   *  the widget. Driven by the server config. */
  setGreeting(text: string | null | undefined): void
  /** "What's new" card above the button (null hides it). Shown only while
   *  closed, and in place of the greeting bubble. */
  setWhatsNew(data: WhatsNew | null): void
  /** Text label beside the icon — turns the circular button into a pill.
   *  Empty/unset restores the icon-only circle. Driven by the server config. */
  setLabel(text: string | null | undefined): void
  /** Move the button (and its greeting bubble) between bottom corners. */
  setPlacement(side: 'left' | 'right'): void
  /** Fade the button in. Called after initial colors are set to avoid a color flash. */
  reveal(): void
  remove(): void
}

// Quackback brand defaults — shown briefly before the server theme fetch
// completes, or as the permanent colors if the fetch fails.
const DEFAULT_BG = '#000000'
const DEFAULT_FG = '#facc15'

const MESSENGER_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>'
const CLOSE_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const BUTTON_TRANSITION =
  'opacity 450ms ease, transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease'
const ICON_TRANSITION =
  'opacity 220ms cubic-bezier(0.34,1.56,0.64,1), transform 220ms cubic-bezier(0.34,1.56,0.64,1)'

const LAUNCHER_SHADOW = '0 1px 6px rgba(15,23,42,0.08), 0 2px 24px rgba(15,23,42,0.16)'
const LAUNCHER_SHADOW_HOVER = '0 2px 8px rgba(15,23,42,0.10), 0 6px 28px rgba(15,23,42,0.20)'

export function createLauncher(opts: LauncherOptions): LauncherHandle {
  let bg = DEFAULT_BG
  let fg = DEFAULT_FG
  // The badge shows unread only while the widget is CLOSED — an alert on the
  // close (X) icon would be nonsensical, and an open widget is already read.
  let unreadCount = 0
  let isOpen = false
  // hideLauncher hides the button and its greeting bubble together.
  let visible = true
  // Visible button label — when set, it doubles as the accessible name.
  let labelText = ''
  // The closed button's accessible name, with the count the badge shows.
  const labels = launcherLabels(opts.locale)
  const openLabel = () => {
    const base = labelText || labels.open
    return unreadCount > 0 ? labels.unread(base, unreadCount) : base
  }
  // Follows the visitor's reduced-motion setting, also when it changes.
  const motionQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  let reduceMotion = !!motionQuery?.matches
  // Proactive greeting bubble state. Dismissal persists per browser session so
  // the bubble invites once without nagging on every page. A contained preview
  // must not write that key — it would hide the bubble for a later host visit.
  let greetingText: string | null = null
  let localDismissed = false
  // The "What's new" card's content, and the card once created.
  let whatsNew: WhatsNew | null = null
  let whatsNewCard: WhatsNewCardHandle | null = null
  const contained = Boolean(opts.root)
  const edge = contained ? '0px' : '24px'
  // On a page that draws under the notch and system bars (viewport-fit=cover),
  // keep the button and its bubble clear of them; env() is 0px elsewhere.
  const sideEdge = (s: 'left' | 'right') =>
    contained ? edge : `calc(${edge} + env(safe-area-inset-${s}, 0px))`
  const bottomEdge = (px: number, containedPx: number) =>
    contained ? `${containedPx}px` : `calc(${px}px + env(safe-area-inset-bottom, 0px))`
  const GREETING_DISMISS_KEY = 'quackback:launcher-greeting-dismissed'
  const greetingDismissed = (): boolean => {
    if (contained) return localDismissed
    try {
      return sessionStorage.getItem(GREETING_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  }

  const btn = document.createElement('button')
  Object.assign(btn.style, {
    position: contained ? 'absolute' : 'fixed',
    bottom: bottomEdge(24, 0),
    [opts.placement === 'left' ? 'left' : 'right']: sideEdge(
      opts.placement === 'left' ? 'left' : 'right'
    ),
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    padding: '0',
    border: 'none',
    borderRadius: '50%',
    backgroundColor: bg,
    color: fg,
    fontSize: '14px',
    fontWeight: '600',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    cursor: 'pointer',
    boxShadow: LAUNCHER_SHADOW,
    opacity: '0',
  })
  btn.setAttribute('aria-label', openLabel())
  btn.setAttribute('aria-expanded', 'false')

  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'relative',
    display: 'flex',
    width: '28px',
    height: '28px',
    flexShrink: '0',
  })

  const iconMessenger = document.createElement('span')
  Object.assign(iconMessenger.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    display: 'flex',
    opacity: '1',
    transform: 'rotate(0deg)',
  })
  iconMessenger.innerHTML = MESSENGER_ICON
  const iconClose = document.createElement('span')
  Object.assign(iconClose.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    display: 'flex',
    opacity: '0',
    transform: 'rotate(-90deg)',
  })
  iconClose.innerHTML = CLOSE_ICON
  const applyMotion = () => {
    btn.style.transition = reduceMotion ? 'none' : BUTTON_TRANSITION
    iconMessenger.style.transition = reduceMotion ? 'none' : ICON_TRANSITION
    iconClose.style.transition = reduceMotion ? 'none' : ICON_TRANSITION
    if (reduceMotion) btn.style.transform = 'translateY(0)'
    whatsNewCard?.applyMotion()
  }
  const onMotionChange = () => {
    reduceMotion = !!motionQuery?.matches
    applyMotion()
  }
  applyMotion()
  motionQuery?.addEventListener?.('change', onMotionChange)
  wrapper.appendChild(iconMessenger)
  wrapper.appendChild(iconClose)
  btn.appendChild(wrapper)

  // Optional text label next to the icon. Hidden until setLabel arrives with
  // the server config; the badge stays the last child either way.
  const labelSpan = document.createElement('span')
  Object.assign(labelSpan.style, {
    display: 'none',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  btn.appendChild(labelSpan)

  // Unread-count badge, top-right of the button. Its own colors (not the theme
  // fg/bg) so it always reads as an alert against any launcher color.
  const badge = document.createElement('span')
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    display: 'none',
    minWidth: '20px',
    height: '20px',
    padding: '0 5px',
    boxSizing: 'border-box',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '10px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: '700',
    lineHeight: '1',
    boxShadow: '0 0 0 2px rgba(255,255,255,0.9)',
    pointerEvents: 'none',
  })
  btn.appendChild(badge)

  const renderBadge = () => {
    const show = unreadCount > 0 && !isOpen
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount)
    badge.style.display = show ? 'flex' : 'none'
  }

  // Proactive greeting bubble — a fixed card sitting just above the button on
  // the same side. Clicking the text opens the widget; the × dismisses it for
  // the session. Its own light card colors so it reads over any launcher color.
  const side = opts.placement === 'left' ? 'left' : 'right'
  const bubble = document.createElement('div')
  Object.assign(bubble.style, {
    position: contained ? 'absolute' : 'fixed',
    bottom: bottomEdge(84, 84),
    [side]: sideEdge(side),
    zIndex: '2147483646',
    display: 'none',
    alignItems: 'center',
    gap: '8px',
    maxWidth: '260px',
    padding: '10px 12px',
    borderRadius: '14px',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: '13px',
    lineHeight: '1.35',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    boxShadow: '0 12px 32px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12)',
  })
  const bubbleText = document.createElement('span')
  Object.assign(bubbleText.style, { cursor: 'pointer', flex: '1' })
  bubbleText.addEventListener('click', () => opts.onClick())
  const bubbleClose = document.createElement('button')
  bubbleClose.type = 'button'
  bubbleClose.setAttribute('aria-label', 'Dismiss')
  bubbleClose.textContent = '×'
  Object.assign(bubbleClose.style, {
    flexShrink: '0',
    width: '18px',
    height: '18px',
    padding: '0',
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: '#9ca3af',
    fontSize: '16px',
    lineHeight: '1',
    cursor: 'pointer',
  })
  // Cards wait for the button: none shows above a launcher not yet revealed.
  let revealed = false
  // A visitor who dismissed the What's new card is not offered the greeting
  // in its place for the rest of the page load.
  let whatsNewDismissed = false
  // One card at a time above the button, by priority. A reply preview, when
  // there is one, goes first in this list.
  const pickCard = (): 'whats-new' | 'greeting' | null => {
    if (!revealed || !visible || isOpen) return null
    if (whatsNew) return 'whats-new'
    if (greetingText && !greetingDismissed() && !whatsNewDismissed) return 'greeting'
    return null
  }
  const renderGreeting = () => {
    const card = pickCard()
    bubble.style.display = card === 'greeting' ? 'flex' : 'none'
    whatsNewCard?.render(card === 'whats-new' ? whatsNew : null)
    // A hidden card leaves nothing behind for a screen reader to find.
    if (card !== 'whats-new') clearAnnouncement()
  }
  bubbleClose.addEventListener('click', () => {
    if (contained) {
      localDismissed = true
    } else {
      try {
        sessionStorage.setItem(GREETING_DISMISS_KEY, '1')
      } catch {
        /* private mode — dismiss for this page load only */
        greetingText = null
      }
    }
    renderGreeting()
  })
  bubble.appendChild(bubbleText)
  bubble.appendChild(bubbleClose)
  const mount = opts.root ?? document.body
  mount.appendChild(bubble)

  // Screen readers hear a card once, politely, when it appears. The region
  // lives from creation, outside any card that toggles display, and gets its
  // text a frame after the card shows, so the change is announced.
  const live = document.createElement('span')
  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')
  Object.assign(live.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
  })
  mount.appendChild(live)
  // Emptied first, so the same words said again are announced again.
  let announceFrame = 0
  const announce = (text: string) => {
    live.textContent = ''
    cancelAnimationFrame(announceFrame)
    announceFrame = requestAnimationFrame(() => {
      announceFrame = 0
      live.textContent = text
    })
  }
  const clearAnnouncement = () => {
    if (announceFrame) cancelAnimationFrame(announceFrame)
    announceFrame = 0
    live.textContent = ''
  }

  // The "What's new" card, created when there is first something to show.
  let spokenId: string | null = null
  let cardSide: 'left' | 'right' = side
  let accent: { backgroundColor: string; foregroundColor: string } | null = null
  const ensureWhatsNewCard = (): WhatsNewCardHandle => {
    if (whatsNewCard) return whatsNewCard
    whatsNewCard = createWhatsNewCard({
      mount,
      side: cardSide,
      contained,
      reduceMotion: () => reduceMotion,
      sideEdge,
      bottom: bottomEdge(84, 84),
      onOpen: (entryId) => opts.onWhatsNewOpen?.(entryId),
      onDismiss: (entryId) => {
        const hadFocus = whatsNewCard?.el.contains(document.activeElement) ?? false
        whatsNew = null
        whatsNewDismissed = true
        renderGreeting()
        if (hadFocus) btn.focus()
        opts.onWhatsNewDismiss?.(entryId)
      },
      onShown: (data) => {
        // Said once per entry; reopening the launcher does not repeat it.
        if (spokenId !== data.entry.id) {
          spokenId = data.entry.id
          announce(`${data.strings.pill}: ${data.entry.title}`)
        }
        opts.onWhatsNewShown?.(data)
      },
    })
    if (accent) whatsNewCard.setAccent(accent)
    return whatsNewCard
  }

  btn.addEventListener('mouseenter', () => {
    if (!reduceMotion) btn.style.transform = 'translateY(-2px)'
    btn.style.boxShadow = LAUNCHER_SHADOW_HOVER
  })
  btn.addEventListener('mouseleave', () => {
    if (!reduceMotion) btn.style.transform = 'translateY(0)'
    btn.style.boxShadow = LAUNCHER_SHADOW
  })
  btn.addEventListener('click', opts.onClick)

  mount.appendChild(btn)

  return {
    el: btn,
    setOpen(open) {
      isOpen = open
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      btn.setAttribute('aria-label', open ? labels.close : openLabel())
      iconMessenger.style.opacity = open ? '0' : '1'
      iconMessenger.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)'
      iconClose.style.opacity = open ? '1' : '0'
      iconClose.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)'
      renderBadge()
      renderGreeting()
    },
    setVisible(show) {
      visible = show
      btn.style.display = show ? 'flex' : 'none'
      renderGreeting()
    },
    setColors(colors) {
      if (colors.backgroundColor) {
        bg = colors.backgroundColor
        btn.style.backgroundColor = bg
      }
      if (colors.foregroundColor) {
        fg = colors.foregroundColor
        btn.style.color = fg
      }
      // The card's count pill wears the launcher's colours.
      accent = { backgroundColor: bg, foregroundColor: fg }
      whatsNewCard?.setAccent(accent)
    },
    setUnread(count) {
      unreadCount = Math.max(0, Math.floor(count))
      renderBadge()
      // A screen reader hears the count the badge shows.
      if (!isOpen) btn.setAttribute('aria-label', openLabel())
    },
    setGreeting(text) {
      const next = text?.trim() || null
      if (contained && next !== greetingText) localDismissed = false
      greetingText = next
      bubbleText.textContent = greetingText ?? ''
      renderGreeting()
    },
    setWhatsNew(data) {
      whatsNew = data
      if (data) ensureWhatsNewCard()
      renderGreeting()
    },
    setLabel(text) {
      labelText = text?.trim() ?? ''
      const show = labelText.length > 0
      labelSpan.textContent = labelText
      labelSpan.style.display = show ? 'block' : 'none'
      // Pill vs. icon-only circle.
      btn.style.width = show ? 'auto' : '48px'
      btn.style.borderRadius = show ? '24px' : '50%'
      btn.style.padding = show ? '0 16px 0 10px' : '0'
      btn.style.gap = show ? '8px' : '0'
      if (!isOpen) btn.setAttribute('aria-label', openLabel())
    },
    setPlacement(side) {
      btn.style.left = side === 'left' ? sideEdge('left') : ''
      btn.style.right = side === 'right' ? sideEdge('right') : ''
      bubble.style.left = side === 'left' ? sideEdge('left') : ''
      bubble.style.right = side === 'right' ? sideEdge('right') : ''
      cardSide = side
      whatsNewCard?.setSide(side)
    },
    reveal() {
      btn.style.opacity = '1'
      revealed = true
      renderGreeting()
    },
    remove() {
      motionQuery?.removeEventListener?.('change', onMotionChange)
      btn.remove()
      bubble.remove()
      live.remove()
      whatsNewCard?.remove()
    },
  }
}
