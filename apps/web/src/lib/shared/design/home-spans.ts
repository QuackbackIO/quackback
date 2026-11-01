/**
 * How Home's blocks fill its rows. Apart from home.ts, which Appearance
 * imports, so the portal's Home and Appearance do not share a chunk.
 */
import type { PortalDesign } from './schema'

type BlockWidth = PortalDesign['pages']['home']['blocks'][number]['width']

/** Columns each width takes: six on a wide screen, two on a medium one. */
const COLUMNS = {
  wide: { third: 2, half: 3, two_thirds: 4, full: 6 },
  medium: { third: 1, half: 1, two_thirds: 2, full: 2 },
} as const
const ROW = { wide: 6, medium: 2 } as const

/**
 * The columns each block takes once its row is filled: a block that leaves
 * its row short, because the next will not fit beside it or it is the last,
 * grows to the row's end, so Home has no holes.
 */
export function filledSpans(widths: BlockWidth[], grid: 'wide' | 'medium'): number[] {
  const spans: number[] = widths.map((width) => COLUMNS[grid][width])
  let used = 0
  spans.forEach((span, index) => {
    if (used + span > ROW[grid]) {
      spans[index - 1] = spans[index - 1]! + ROW[grid] - used
      used = 0
    }
    used += span
  })
  if (spans.length) spans[spans.length - 1] = spans[spans.length - 1]! + ROW[grid] - used
  return spans
}
