/**
 * How much a page's content moves under the visitor, scored as Chrome scores
 * Cumulative Layout Shift: shifts are grouped into session windows (a gap of
 * over a second, or five seconds in all, starts the next) and the largest
 * window is the score. Shifts within half a second of an input are the page
 * answering it, and the browser marks them; they are left out before scoring.
 */

/** One layout shift: when it happened (ms on the page's clock) and its score. */
export interface Shift {
  t: number
  v: number
}

const GAP_MS = 1000
const WINDOW_MS = 5000

export function layoutShiftScore(shifts: readonly Shift[]): number {
  let best = 0
  let current = 0
  let start = -Infinity
  let last = -Infinity
  for (const shift of [...shifts].sort((a, b) => a.t - b.t)) {
    if (shift.t - last > GAP_MS || shift.t - start > WINDOW_MS) {
      current = 0
      start = shift.t
    }
    current += shift.v
    last = shift.t
    best = Math.max(best, current)
  }
  // Four places: a shift too small to see stays out of the reading.
  return Math.round(best * 10_000) / 10_000
}

/**
 * Installed before any page script: records the page's layout shifts from its
 * first paint, without those the browser marks as answering an input.
 */
export const LAYOUT_SHIFT_SCRIPT = `
  window.__perfShifts = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__perfShifts.push({ t: e.startTime, v: e.value })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
`
