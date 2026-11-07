/**
 * Home blocks from before the grid had a width (a third, a half, two thirds
 * or the whole row) and their order. Read, they take places on the grid in
 * that order: their share of twelve columns, packed left to right, top to
 * bottom, one row each so their content sets the row's height, a row's last
 * block growing to the row's end: exactly the old rows. The composer in the
 * band took no room in them, so it goes last. A block without a place, such
 * as one an older client sends, goes under the rest the same way.
 */
import { bottomOf, packWidths } from './home-grid'
import { BLOCK_SIZES, type BlockType } from './options'

/** Columns of twelve each old width took. */
export const LEGACY_WIDTH_COLUMNS: Readonly<Record<string, number>> = {
  third: 4,
  half: 6,
  two_thirds: 8,
  full: 12,
}

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const placed = (block: Raw) => isRecord(block.grid)

/** A Home object whose blocks all have places and no widths; anything else comes back as it is. */
export function withGridPlaces(home: unknown): unknown {
  if (!isRecord(home) || !Array.isArray(home.blocks)) return home
  const blocks = home.blocks as unknown[]
  const records = blocks.filter(isRecord)
  if (records.every((block) => placed(block) && !('width' in block))) return home
  const sizes = BLOCK_SIZES as Partial<Record<string, (typeof BLOCK_SIZES)[BlockType]>>
  // The composer in the band took no room in the old rows, so it is packed after them.
  const band =
    home.composer === 'band' ? records.find((block) => block.type === 'composer') : undefined
  const unplaced = records.filter((block) => !placed(block))
  const waiting = [
    ...unplaced.filter((block) => block !== band),
    ...unplaced.filter((b) => b === band),
  ]
  const start = bottomOf(
    records.filter(placed).map((block) => {
      const { y, h } = block.grid as Raw
      return { x: 0, w: 1, y: Number(y) || 0, h: Number(h) || 0 }
    })
  )
  const packed = packWidths(
    waiting.map((block, i) => {
      const size = sizes[String(block.type)]?.size ?? [12, 1]
      const w = LEGACY_WIDTH_COLUMNS[String(block.width)] ?? size[0]
      return { id: String(i), w, h: size[1] }
    }),
    start
  )
  const next = blocks.map((block) => {
    if (!isRecord(block)) return block
    const { width: _width, ...rest } = block
    if (placed(block)) return rest
    const { x, y, w, h } = packed[waiting.indexOf(block)]!
    return { ...rest, grid: { x, y, w, h } }
  })
  return { ...home, blocks: next }
}
