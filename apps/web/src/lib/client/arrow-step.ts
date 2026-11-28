/**
 * The step an arrow key takes through a row of choices: -1 back, 1 next, 0
 * for any other key. Left and Right follow what the reader sees, so in a
 * right-to-left layout the Left key moves to the next choice. Up and Down
 * step back and next in both directions when `vertical` is set.
 */
export function arrowStep(
  event: { key: string; currentTarget: Element },
  { vertical = false }: { vertical?: boolean } = {}
): -1 | 0 | 1 {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    return (event.key === 'ArrowRight') !== rtl ? 1 : -1
  }
  if (!vertical) return 0
  if (event.key === 'ArrowDown') return 1
  if (event.key === 'ArrowUp') return -1
  return 0
}
