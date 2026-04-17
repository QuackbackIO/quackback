export interface LauncherOptions {
  placement: 'left' | 'right'
  /** Background color of the button. Defaults to a neutral indigo if omitted. */
  backgroundColor?: string
  /** Foreground (icon) color. Defaults to white if omitted. */
  foregroundColor?: string
  onClick: () => void
}

export interface LauncherHandle {
  el: HTMLButtonElement
  setOpen(open: boolean): void
  /** Replace the button colors (typically called after server config fetch). */
  setColors(colors: { backgroundColor?: string; foregroundColor?: string }): void
  remove(): void
}

const DEFAULT_BG = '#6366f1'
const DEFAULT_FG = '#ffffff'

const CHAT_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>'
const CLOSE_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function createLauncher(opts: LauncherOptions): LauncherHandle {
  let bg = opts.backgroundColor ?? DEFAULT_BG
  let fg = opts.foregroundColor ?? DEFAULT_FG

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
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    transition:
      'transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease',
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
  const iconChat = document.createElement('span')
  Object.assign(iconChat.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    display: 'flex',
    opacity: '1',
    transform: 'rotate(0deg)',
    transition: iconTransition,
  })
  iconChat.innerHTML = CHAT_ICON
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
  wrapper.appendChild(iconChat)
  wrapper.appendChild(iconClose)
  btn.appendChild(wrapper)

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
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
      btn.setAttribute('aria-label', open ? 'Close feedback widget' : 'Open feedback widget')
      iconChat.style.opacity = open ? '0' : '1'
      iconChat.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)'
      iconClose.style.opacity = open ? '1' : '0'
      iconClose.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)'
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
    remove() {
      btn.remove()
    },
  }
}
