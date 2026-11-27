/**
 * The host page's safe-area insets, sent by the embed script as
 * `{ type: 'quackback:safe-area', data: { top, bottom, left, right } }` in CSS
 * pixels. A frame reads `env(safe-area-inset-*)` as zero, so where the panel
 * fills the screen, the widget's edges would sit under the notch, a side
 * cutout or the system bars. The embed script sends zeros for the floating
 * panel, which its own offsets keep clear of them. The
 * values become `--qb-safe-top`, `--qb-safe-bottom`, `--qb-safe-left` and
 * `--qb-safe-right` on the root element, which the widget shell pads by.
 */
export const HOST_SAFE_AREA_MESSAGE = 'quackback:safe-area'

/** Larger than any real inset; a bigger value is not a safe area. */
const MAX_INSET_PX = 200

const SIDES = ['top', 'bottom', 'left', 'right'] as const
type Side = (typeof SIDES)[number]

function inset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), MAX_INSET_PX)
    : 0
}

export function applyHostSafeArea(data: unknown): void {
  const d = (data ?? {}) as Record<Side, unknown>
  const root = document.documentElement.style
  for (const side of SIDES) root.setProperty(`--qb-safe-${side}`, `${inset(d[side])}px`)
}

// Listen from module load: the embed script sends the insets on ready,
// before any view has rendered.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const msg = event.data as { type?: unknown; data?: unknown } | null
    if (msg?.type !== HOST_SAFE_AREA_MESSAGE) return
    applyHostSafeArea(msg.data)
  })
}
