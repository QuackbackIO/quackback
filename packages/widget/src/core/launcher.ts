export interface LauncherOptions {
  placement: 'left' | 'right'
  onClick: () => void
}

export interface LauncherHandle {
  el: HTMLButtonElement
  setOpen(open: boolean): void
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

export function createLauncher(opts: LauncherOptions): LauncherHandle {
  let bg = DEFAULT_BG
  let fg = DEFAULT_FG
  // The badge shows unread only while the widget is CLOSED — an alert on the
  // close (X) icon would be nonsensical, and an open widget is already read.
  let unreadCount = 0
  let isOpen = false
  // Visible button label — when set, it doubles as the accessible name.
  let labelText = ''
  // Proactive greeting bubble state. Dismissal persists per browser session so
  // the bubble invites once without nagging on every page.
  let greetingText: string | null = null
  const GREETING_DISMISS_KEY = 'quackback:launcher-greeting-dismissed'
  const greetingDismissed = (): boolean => {
    try {
      return sessionStorage.getItem(GREETING_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  }

  const btn = document.createElement('button')
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    [opts.placement === 'left' ? 'left' : 'right']: '24px',
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
    boxShadow: '0 12px 32px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.18)',
    opacity: '0',
    transition:
      'opacity 450ms ease, transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease',
  })
  btn.setAttribute('aria-label', 'Open feedback widget')
  btn.setAttribute('aria-expanded', 'false')

  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'relative',
    display: 'flex',
    width: '28px',
    height: '28px',
    flexShrink: '0',
  })

  const iconTransition =
    'opacity 220ms cubic-bezier(0.34,1.56,0.64,1), transform 220ms cubic-bezier(0.34,1.56,0.64,1)'
  const iconMessenger = document.createElement('span')
  Object.assign(iconMessenger.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    display: 'flex',
    opacity: '1',
    transform: 'rotate(0deg)',
    transition: iconTransition,
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
    transition: iconTransition,
  })
  iconClose.innerHTML = CLOSE_ICON
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
    backgroundColor: '#ef4444',
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
    position: 'fixed',
    bottom: '84px',
    [side]: '24px',
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
  const renderGreeting = () => {
    const show = !!greetingText && !isOpen && !greetingDismissed()
    bubble.style.display = show ? 'flex' : 'none'
  }
  bubbleClose.addEventListener('click', () => {
    try {
      sessionStorage.setItem(GREETING_DISMISS_KEY, '1')
    } catch {
      /* private mode — dismiss for this page load only */
      greetingText = null
    }
    renderGreeting()
  })
  bubble.appendChild(bubbleText)
  bubble.appendChild(bubbleClose)
  document.body.appendChild(bubble)

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'translateY(-2px)'
    btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'translateY(0)'
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
  })
  btn.addEventListener('click', opts.onClick)

  document.body.appendChild(btn)

  return {
    el: btn,
    setOpen(open) {
      isOpen = open
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      btn.setAttribute(
        'aria-label',
        open ? 'Close feedback widget' : labelText || 'Open feedback widget'
      )
      iconMessenger.style.opacity = open ? '0' : '1'
      iconMessenger.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)'
      iconClose.style.opacity = open ? '1' : '0'
      iconClose.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)'
      renderBadge()
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
    },
    setUnread(count) {
      unreadCount = Math.max(0, Math.floor(count))
      renderBadge()
    },
    setGreeting(text) {
      greetingText = text?.trim() || null
      bubbleText.textContent = greetingText ?? ''
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
      if (!isOpen) btn.setAttribute('aria-label', labelText || 'Open feedback widget')
    },
    setPlacement(side) {
      btn.style.left = side === 'left' ? '24px' : ''
      btn.style.right = side === 'right' ? '24px' : ''
      bubble.style.left = side === 'left' ? '24px' : ''
      bubble.style.right = side === 'right' ? '24px' : ''
    },
    reveal() {
      btn.style.opacity = '1'
    },
    remove() {
      btn.remove()
      bubble.remove()
    },
  }
}
