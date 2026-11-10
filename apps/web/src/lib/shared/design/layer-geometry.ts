/**
 * Where the builder's editing layer draws over the canvas: a block's box in
 * the frame, mapped onto the layer at the canvas's scale, and the place of
 * the picked block's chip.
 */

/** A box, in the frame's viewport or on the layer. */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** A box in the frame's viewport, as the layer over the scaled frame draws it. */
export function toLayerRect(rect: Rect, scale: number): Rect {
  return {
    left: rect.left * scale,
    top: rect.top * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

/**
 * An outline's box: just outside the block, kept within the canvas so a
 * block against its edge, such as the header, still shows every side.
 */
export function outlineBox(rect: Rect, out: number, room: { width: number; height: number }): Rect {
  const edge = out + 1
  const left = Math.max(rect.left - out, edge)
  const top = Math.max(rect.top - out, edge)
  const right = Math.min(rect.left + rect.width + out, room.width - edge)
  const bottom = Math.min(rect.top + rect.height + out, room.height - edge)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** How far the chip sits in from the block's start, and from the canvas's sides. */
const CHIP_INSET = 12
const EDGE = 4
/** How far below the visible top of the block the chip sits, when it sits inside. */
const INSIDE = 8
/** How far the chip keeps from something small it names. */
const SMALL_GAP = 2

/**
 * Where the picked block's chip goes: centred on the block's top edge, or
 * when there is no room above, on the bottom edge of a short block such as
 * the header, else inside the block at the top of what shows of it. Kept
 * within the canvas sideways; null when the block is out of view.
 */
export function chipPlacement(
  block: Rect,
  chip: { width: number; height: number },
  room: { width: number; height: number }
): { left: number; top: number; inside: boolean } | null {
  if (block.top + block.height <= 0 || block.top >= room.height) return null
  const left = Math.max(EDGE, Math.min(block.left + CHIP_INSET, room.width - chip.width - EDGE))
  // Something about as small as the chip, such as the logo: wholly clear of it, above else below.
  if (block.height <= chip.height * 1.5) {
    const over = block.top - chip.height - SMALL_GAP
    if (over >= 0) return { left, top: over, inside: false }
    return { left, top: block.top + block.height + SMALL_GAP, inside: false }
  }
  const above = block.top - chip.height / 2
  if (above >= 0) return { left, top: above, inside: false }
  // Too short to hold the chip clear of what it shows, such as the header: on its bottom edge.
  if (block.top >= 0 && block.height < chip.height * 3)
    return { left, top: block.top + block.height - chip.height / 2, inside: false }
  return { left, top: Math.max(block.top, 0) + INSIDE, inside: true }
}

/** The size of "+" at the end of the menu. */
const PLUS = 24
/** How far "+" sits after the menu's last item. */
const PLUS_GAP = 6

/**
 * Where "+" goes: just after the menu's row, centred on it, and always
 * inside the canvas, even when the row runs past its edge (as on a phone)
 * or is scrolled out of view.
 */
export function plusPlacement(
  row: Rect,
  room: { width: number; height: number }
): { left: number; top: number } {
  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max - PLUS - EDGE))
  return {
    left: clamp(row.left + row.width + PLUS_GAP, room.width),
    top: clamp(row.top + row.height / 2 - PLUS / 2, room.height),
  }
}
