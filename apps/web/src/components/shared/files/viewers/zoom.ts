/** The zoom range every engine shares, so the shell's controls behave alike. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2

/** Holds `value` in the shared range; `floor` lets a narrow fit go below it. */
export function clampZoom(value: number, floor: number = ZOOM_MIN): number {
  const min = Math.min(ZOOM_MIN, floor)
  return Math.min(ZOOM_MAX, Math.max(min, value))
}
