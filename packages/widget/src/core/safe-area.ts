export interface SafeArea {
  top: number
  bottom: number
}

/**
 * The host page's safe-area insets in CSS pixels: the space a notch, a home
 * indicator or an edge-to-edge navigation bar takes from the screen. A frame
 * always reads zero for these, so the page that embeds it measures them.
 * Zero when the page does not draw under those areas (no
 * `viewport-fit=cover`), which is most pages.
 */
export function measureSafeArea(): SafeArea {
  const probe = document.createElement('div')
  probe.dataset.quackbackSafeArea = ''
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)'
  document.body.appendChild(probe)
  try {
    const style = window.getComputedStyle(probe)
    return { top: toPx(style.paddingTop), bottom: toPx(style.paddingBottom) }
  } finally {
    probe.remove()
  }
}

function toPx(value: string | undefined): number {
  const n = Number.parseFloat(value ?? '')
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}
