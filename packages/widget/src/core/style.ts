const STYLE_ID = 'quackback-widget-styles'

/** Where the panel fills the screen instead of floating by the launcher. The
 *  SDK matches the same query to decide whether the frame needs the host
 *  page's safe-area insets. */
// Narrow screens, and short touch screens: a phone held sideways is wide but
// short, and gets the full-screen panel too.
export const FULL_SCREEN_MEDIA = '(max-width:639px),(max-height:500px) and (pointer:coarse)'

// The panel CSS is side-specific (corner offset + transform origin), so the
// element is rewritten when the side changes after creation — e.g. the server
// config's position landing after an idle-time panel preload.
let currentSide: 'left' | 'right' | null = null

export function ensureStyles(side: 'left' | 'right'): void {
  const existing = document.getElementById(STYLE_ID)
  if (existing && currentSide === side) return
  currentSide = side
  const el = existing ?? document.createElement('style')
  el.id = STYLE_ID
  // On a page drawn under the notch and system bars (viewport-fit=cover) the
  // launcher moves in by the safe-area insets, so the panel above it does
  // too. env() is 0px elsewhere.
  const sideInset = `env(safe-area-inset-${side},0px)`
  const maxHeight =
    'calc(100vh - 108px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px))'
  const maxWidth =
    'calc(100vw - 48px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px))'
  el.textContent = [
    '.quackback-panel{position:fixed;z-index:2147483647;overflow:hidden;pointer-events:none;',
    `bottom:calc(88px + env(safe-area-inset-bottom,0px));${side}:calc(24px + ${sideInset});`,
    `width:min(400px,${maxWidth});height:min(704px,${maxHeight});`,
    'border-radius:16px;box-shadow:0 0 0 1px rgba(15,23,42,0.06),0 2px 6px rgba(15,23,42,0.06),0 24px 60px -12px rgba(15,23,42,0.28);',
    `opacity:0;transform:scale(0);transform-origin:bottom ${side};`,
    'transition:opacity 280ms cubic-bezier(0.34,1.56,0.64,1),transform 280ms cubic-bezier(0.34,1.56,0.64,1),',
    'width 520ms cubic-bezier(0.26,1,0.32,1),height 520ms cubic-bezier(0.26,1,0.32,1)}',
    // Long-form content (posts, articles, changelog entries) grows the panel.
    // Desktop-scoped: on mobile the panel is already full-screen, and this
    // higher-specificity rule would otherwise SHRINK it there.
    // The panel's bottom sits 88px up, so the height leaves room for that.
    `@media(min-width:640px){.quackback-panel.quackback-expanded{width:min(720px,${maxWidth});height:min(780px,${maxHeight})}}`,
    '.quackback-panel.quackback-open{opacity:1;transform:scale(1);pointer-events:auto}',
    '.quackback-panel.quackback-closing{opacity:0;transform:scale(0);pointer-events:none;',
    'transition:opacity 200ms cubic-bezier(0.4,0,1,1),transform 200ms cubic-bezier(0.4,0,1,1)}',
    `@media${FULL_SCREEN_MEDIA}{`,
    // 100vh is the tallest the viewport gets (browser toolbars hidden), so it
    // runs under a visible toolbar or system bar; 100dvh is what is on screen.
    // The expanded selector outranks the desktop expanded size, which still
    // matches a phone held sideways (wide, but short).
    '.quackback-panel,.quackback-panel.quackback-expanded{top:0;left:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;',
    'border-radius:0;box-shadow:none;',
    'opacity:1;visibility:hidden;transform:translateY(100%);transform-origin:center;',
    'transition:transform 300ms cubic-bezier(0.4,0,0.2,1),visibility 0s linear 300ms}',
    '.quackback-panel.quackback-open{transform:translateY(0);visibility:visible;transition:transform 300ms cubic-bezier(0.4,0,0.2,1),visibility 0s linear 0s}',
    '.quackback-panel.quackback-closing{transform:translateY(100%);visibility:hidden;transition:transform 200ms cubic-bezier(0.4,0,1,1),visibility 0s linear 200ms}}',
    '.quackback-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.4);',
    'opacity:0;pointer-events:none;transition:opacity 200ms ease}',
    '.quackback-backdrop.quackback-open{opacity:1;pointer-events:auto}',
    '@media(min-width:640px){.quackback-backdrop{display:none!important}}',
    '@media(prefers-reduced-motion:reduce){.quackback-panel,.quackback-panel.quackback-open,.quackback-panel.quackback-closing,.quackback-backdrop{transition:none!important}}',
  ].join('')
  if (!existing) document.head.appendChild(el)
}

export function removeStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
  currentSide = null
}
