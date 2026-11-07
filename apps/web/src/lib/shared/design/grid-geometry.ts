/**
 * Home's grid as the frame draws it, for the builder's drag: where each
 * column and row starts, read from the grid's computed tracks (rows grow to
 * fit their content, so they are measured, not assumed), and the cell
 * nearest a point. Rows past the last drawn one are a unit tall.
 */
import type { GridPlace } from './home-grid'
import type { Rect } from './layer-geometry'

export interface GridMetrics {
  /** The grid's content box, in the frame's viewport. */
  left: number
  top: number
  width: number
  columns: number
  columnGap: number
  rowGap: number
  /** Each drawn row's height, top to bottom. */
  rows: number[]
  /** A row's least height. */
  unit: number
}

/** Track sizes from a computed `grid-template-*` value, such as "24px 56.5px"; none for "none". */
export function parseTracks(value: string): number[] {
  return value
    .split(/\s+/)
    .map((part) => /^(-?\d+(?:\.\d+)?)px$/.exec(part)?.[1])
    .filter((part): part is string => part !== undefined)
    .map(Number)
}

const columnWidth = (m: GridMetrics) => (m.width - m.columnGap * (m.columns - 1)) / m.columns

/** Where column `i` starts, from the grid's left. */
export const columnStart = (m: GridMetrics, i: number) => i * (columnWidth(m) + m.columnGap)

/** How tall row `i` is: as drawn, or a unit past the last drawn. */
export const rowHeight = (m: GridMetrics, i: number) => m.rows[i] ?? m.unit

/** Where row `i` starts, from the grid's top. */
export function rowStart(m: GridMetrics, i: number): number {
  let top = 0
  for (let row = 0; row < i; row++) top += rowHeight(m, row) + m.rowGap
  return top
}

/** A place's box, in the frame's viewport. */
export function placeRect(m: GridMetrics, place: GridPlace): Rect {
  const top = rowStart(m, place.y)
  const last = place.y + place.h - 1
  return {
    left: m.left + columnStart(m, place.x),
    top: m.top + top,
    width: place.w * columnWidth(m) + (place.w - 1) * m.columnGap,
    height: rowStart(m, last) + rowHeight(m, last) - top,
  }
}

const nearest = (count: number, at: (i: number) => number, target: number, from = 0) => {
  let best = from
  for (let i = from; i < count; i++)
    if (Math.abs(at(i) - target) < Math.abs(at(best) - target)) best = i
  return best
}

/** The column nearest to start at `left`, from the grid's left, for a block `w` columns wide. */
export function columnAt(m: GridMetrics, left: number, w = 1): number {
  return nearest(Math.max(1, m.columns - w + 1), (i) => columnStart(m, i), left)
}

/** How far down rows are looked for: the drawn rows and a screen or so more. */
const rowsToLook = (m: GridMetrics) => m.rows.length + 40

/** The row nearest to start at `top`, from the grid's top. */
export function rowAt(m: GridMetrics, top: number): number {
  return nearest(rowsToLook(m), (i) => rowStart(m, i), top)
}

/** Columns from column `x` to the column end nearest `right`, at least one and within the grid. */
export function columnsTo(m: GridMetrics, x: number, right: number): number {
  const end = (w: number) => columnStart(m, x + w - 1) + columnWidth(m)
  return nearest(m.columns - x + 1, end, right, 1)
}

/** Rows from row `y` to the row end nearest `bottom`, at least one. */
export function rowsTo(m: GridMetrics, y: number, bottom: number): number {
  const end = (h: number) => rowStart(m, y + h - 1) + rowHeight(m, y + h - 1)
  return nearest(rowsToLook(m) - y, end, bottom, 1)
}

/** The metrics of a grid element in a document, or null when it is not a grid. */
export function measureGrid(element: Element): GridMetrics | null {
  const view = element.ownerDocument.defaultView
  if (!view) return null
  const style = view.getComputedStyle(element)
  const columns = parseTracks(style.gridTemplateColumns)
  if (!columns.length) return null
  const box = element.getBoundingClientRect()
  const px = (value: string) => Number.parseFloat(value) || 0
  return {
    left: box.left + px(style.paddingLeft) + px(style.borderLeftWidth),
    top: box.top + px(style.paddingTop) + px(style.borderTopWidth),
    width:
      columns.reduce((sum, size) => sum + size, 0) + px(style.columnGap) * (columns.length - 1),
    columns: columns.length,
    columnGap: px(style.columnGap),
    rowGap: px(style.rowGap),
    rows: parseTracks(style.gridTemplateRows),
    unit: px(style.getPropertyValue('--qb-row')) || 24,
  }
}
