/**
 * Home's grid, as a dashboard's: twelve columns on a desktop, rows a fixed
 * unit tall, each block a box of whole cells. Pure, so the portal, the
 * builder and the server lay blocks out alike.
 *
 * Height and content: content sets a block's height. The portal's rows are
 * `minmax(unit, auto)` and blocks take one row unless made taller, so a row
 * is as tall as the tallest content in it and the blocks beside it stretch
 * to match, as Home's rows always did; content is never cut off and no block
 * shows blank space it did not ask for. A block given more rows spans them,
 * and is at least as tall as they are. The builder shows the portal itself,
 * so what an admin sees there is what visitors see.
 *
 * Blocks float up to fill gaps (vertical compaction). A block moved or
 * resized onto others pushes them down; one moved down past another lets
 * that one rise into the place it left. Nothing leaves the grid or goes
 * under its least size. Tablets lay the blocks out again on fewer columns,
 * and phones stack them, in reading order: top to bottom, left to right.
 */

/** Columns on a desktop. */
export const GRID_COLUMNS = 12
/** Columns on a tablet. */
export const TABLET_COLUMNS = 2
/** A row's least height, in px; the gap between rows is the page's block gap. */
export const ROW_UNIT_PX = 24
/** The most rows a block can take. */
export const MAX_ROWS = 60

/** A block's box on the grid: its column and row, from 0, and how many of each it takes. */
export interface GridPlace {
  x: number
  y: number
  w: number
  h: number
}

/** A box with its block's id and least size. */
export interface GridItem extends GridPlace {
  id: string
  minW?: number
  minH?: number
}

const clampTo = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Math.round(value)))

/** Whether two boxes share a cell. */
export function collides(a: GridPlace, b: GridPlace): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** The row under the lowest block. */
export function bottomOf(items: readonly GridPlace[]): number {
  return items.reduce((low, item) => Math.max(low, item.y + item.h), 0)
}

/** Top to bottom, then left to right: the order a phone shows, and a screen reader reads. */
export function readingOrder<T extends GridPlace>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** A box kept on a grid of `columns`, at least its least size. */
function bounded<T extends GridItem>(item: T, columns = GRID_COLUMNS): T {
  const w = clampTo(item.w, Math.min(item.minW ?? 1, columns), columns)
  const h = clampTo(item.h, item.minH ?? 1, MAX_ROWS)
  return { ...item, w, h, x: clampTo(item.x, 0, columns - w), y: Math.max(0, Math.round(item.y)) }
}

/**
 * Every block floated up as far as it goes without passing another, top
 * blocks first. The items come back in the order given.
 */
export function compact<T extends GridItem>(items: readonly T[]): T[] {
  const placed: T[] = []
  const moved = new Map<string, T>()
  for (const item of readingOrder(items)) {
    let y = item.y
    while (y > 0 && !placed.some((other) => collides({ ...item, y: y - 1 }, other))) y--
    for (let hit = placed.find((other) => collides({ ...item, y }, other)); hit;) {
      y = hit.y + hit.h
      hit = placed.find((other) => collides({ ...item, y }, other))
    }
    const at = { ...item, y }
    placed.push(at)
    moved.set(item.id, at)
  }
  return items.map((item) => moved.get(item.id)!)
}

/** Each block pushed down below any it overlaps, in reading order. */
function separate<T extends GridItem>(items: readonly T[], first?: T): T[] {
  const placed: T[] = first ? [first] : []
  for (const item of readingOrder(items)) {
    if (first && item.id === first.id) continue
    let at = item
    for (let hit = placed.find((other) => collides(at, other)); hit;) {
      at = { ...at, y: hit.y + hit.h }
      hit = placed.find((other) => collides(at, other))
    }
    placed.push(at)
  }
  const byId = new Map(placed.map((item) => [item.id, item]))
  return items.map((item) => byId.get(item.id)!)
}

/**
 * A layout made whole: every block in the grid and at its least size, none
 * overlapping, all floated up. What any layout from outside, such as an old
 * design or Quackback AI's, goes through before it is drawn.
 */
export function settle<T extends GridItem>(items: readonly T[], columns = GRID_COLUMNS): T[] {
  return compact(separate(items.map((item) => bounded(item, columns))))
}

const replace = <T extends GridItem>(items: readonly T[], next: T) =>
  items.map((item) => (item.id === next.id ? next : item))

/**
 * The layout with one block moved to a cell. Blocks in its way go down below
 * it, except that moving down past a block lets that block rise into the
 * room above it when it fits there; then everything floats up.
 */
export function moveItem<T extends GridItem>(
  items: readonly T[],
  id: string,
  x: number,
  y: number
): T[] {
  const from = items.find((item) => item.id === id)
  if (!from) return [...items]
  const to = bounded({ ...from, x, y })
  if (to.x === from.x && to.y === from.y) return [...items]
  let next = replace(items, to)
  if (to.y > from.y) {
    const rest = () => next.filter((item) => item.id !== id)
    for (const hit of readingOrder(rest().filter((item) => collides(item, to)))) {
      const up = { ...hit, y: to.y - hit.h }
      const free = up.y >= 0 && !next.some((other) => other.id !== hit.id && collides(up, other))
      if (free) next = replace(next, up)
    }
  }
  return compact(separate(next, to))
}

/** The layout with one block at a new size, kept in the grid; blocks in its way go down. */
export function resizeItem<T extends GridItem>(
  items: readonly T[],
  id: string,
  w: number,
  h: number
): T[] {
  const from = items.find((item) => item.id === id)
  if (!from) return [...items]
  const sized = bounded({ ...from, w: Math.min(w, GRID_COLUMNS - from.x), h })
  const to = { ...sized, x: from.x }
  return compact(separate(replace(items, to), to))
}

export type Nudge = 'left' | 'right' | 'up' | 'down' | 'wider' | 'narrower' | 'taller' | 'shorter'

const samePlaces = (a: readonly GridItem[], b: readonly GridItem[]) =>
  a.every((item, i) => {
    const other = b[i]!
    return item.x === other.x && item.y === other.y && item.w === other.w && item.h === other.h
  })

/**
 * The layout after one keyboard step: a move by a cell, or a resize by one.
 * Moving down goes as far as it takes for the block to land lower, past the
 * block under it. Null when the step changes nothing, at an edge or at the
 * block's least size.
 */
export function nudge<T extends GridItem>(
  items: readonly T[],
  id: string,
  step: Nudge
): T[] | null {
  const item = items.find((one) => one.id === id)
  if (!item) return null
  const changed = (next: T[]) => (samePlaces(next, items) ? null : next)
  switch (step) {
    case 'left':
    case 'right':
      return changed(moveItem(items, id, item.x + (step === 'left' ? -1 : 1), item.y))
    case 'up':
      return changed(moveItem(items, id, item.x, item.y - 1))
    case 'down': {
      const low = bottomOf(items)
      for (let y = item.y + 1; y <= low; y++) {
        const next = moveItem(items, id, item.x, y)
        if (next.find((one) => one.id === id)!.y > item.y) return next
      }
      return null
    }
    case 'wider':
    case 'narrower':
      return changed(resizeItem(items, id, item.w + (step === 'wider' ? 1 : -1), item.h))
    case 'taller':
    case 'shorter':
      return changed(resizeItem(items, id, item.w, item.h + (step === 'taller' ? 1 : -1)))
  }
}

/**
 * Blocks of given widths packed left to right, top to bottom, from row
 * `startY`, as Home's old rows were: a row's last block grows to the row's
 * end, and every block in a row takes the row's tallest height.
 */
export function packWidths(
  entries: ReadonlyArray<{ id: string; w: number; h: number }>,
  startY = 0
): GridItem[] {
  const rows: Array<Array<{ id: string; w: number; h: number }>> = []
  let used = GRID_COLUMNS
  for (const entry of entries) {
    const w = clampTo(entry.w, 1, GRID_COLUMNS)
    if (used + w > GRID_COLUMNS) {
      rows.push([])
      used = 0
    }
    rows.at(-1)!.push({ ...entry, w })
    used += w
  }
  const out: GridItem[] = []
  let y = startY
  for (const row of rows) {
    const h = Math.max(...row.map((entry) => entry.h))
    let x = 0
    row.forEach((entry, i) => {
      const w = i === row.length - 1 ? GRID_COLUMNS - x : entry.w
      out.push({ id: entry.id, x, y, w, h })
      x += w
    })
    y += h
  }
  return out
}

/**
 * Blocks laid out again on `columns` columns in reading order, each taking
 * its share of them, at least one, then floated up: a tablet's layout, or a
 * phone's single column.
 */
export function flowLayout<T extends GridItem>(items: readonly T[], columns: number): T[] {
  const placed: T[] = []
  let x = 0
  let y = 0
  let rowEnd = 0
  for (const item of readingOrder(items)) {
    const w = clampTo(Math.ceil((item.w * columns) / GRID_COLUMNS - 1e-9), 1, columns)
    if (x + w > columns) {
      x = 0
      y = rowEnd
    }
    placed.push({ ...item, x, y, w })
    rowEnd = Math.max(rowEnd, y + item.h)
    x += w
  }
  return compact(placed)
}
