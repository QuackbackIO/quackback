/**
 * Where the editing layer draws: a block's box in the frame mapped onto the
 * builder at the canvas's scale, and the picked block's chip on its top edge,
 * inside the block when there is no room above it.
 */
import { describe, expect, it } from 'vitest'
import { chipPlacement, outlineBox, plusPlacement, toLayerRect } from '../layer-geometry'

describe('toLayerRect', () => {
  it('scales a box in the frame onto the layer', () => {
    expect(toLayerRect({ left: 100, top: 200, width: 400, height: 80 }, 0.5)).toEqual({
      left: 50,
      top: 100,
      width: 200,
      height: 40,
    })
  })

  it('keeps a box as it is at full size', () => {
    const box = { left: 10, top: -30, width: 20, height: 40 }
    expect(toLayerRect(box, 1)).toEqual(box)
  })
})

describe('chipPlacement', () => {
  const chip = { width: 200, height: 28 }
  const room = { width: 800, height: 600 }

  it('sits on the block’s top edge when there is room above', () => {
    expect(chipPlacement({ left: 40, top: 100, width: 400, height: 200 }, chip, room)).toEqual({
      left: 52,
      top: 86,
      inside: false,
    })
  })

  it('moves inside the block when its top is too near the top of the canvas', () => {
    expect(chipPlacement({ left: 40, top: 6, width: 400, height: 200 }, chip, room)).toEqual({
      left: 52,
      top: 14,
      inside: true,
    })
  })

  it('sits on the bottom edge of a short block at the top, such as the header, clear of its menu', () => {
    expect(chipPlacement({ left: 0, top: 0, width: 800, height: 54 }, chip, room)).toEqual({
      left: 12,
      top: 40,
      inside: false,
    })
  })

  it('keeps wholly clear of something about as small as itself, such as the logo', () => {
    // At the top of the canvas: below it, never over it.
    const logo = { left: 50, top: 10, width: 70, height: 16 }
    const placed = chipPlacement(logo, chip, room)!
    expect(placed.top).toBeGreaterThanOrEqual(logo.top + logo.height)
    // With room above: above it.
    const lower = chipPlacement({ ...logo, top: 100 }, chip, room)!
    expect(lower.top + chip.height).toBeLessThanOrEqual(100)
  })

  it('stays at the top of what shows of a block scrolled partly out of view', () => {
    const placed = chipPlacement({ left: 40, top: -150, width: 400, height: 300 }, chip, room)
    expect(placed).toEqual({ left: 52, top: 8, inside: true })
  })

  it('keeps within the canvas sideways', () => {
    expect(chipPlacement({ left: 700, top: 100, width: 100, height: 50 }, chip, room)?.left).toBe(
      596
    )
    expect(chipPlacement({ left: -50, top: 100, width: 100, height: 50 }, chip, room)?.left).toBe(4)
  })

  it('shows no chip for a block out of view', () => {
    expect(chipPlacement({ left: 0, top: -300, width: 400, height: 200 }, chip, room)).toBeNull()
    expect(chipPlacement({ left: 0, top: 640, width: 400, height: 200 }, chip, room)).toBeNull()
  })
})

describe('outlineBox', () => {
  const room = { width: 800, height: 600 }

  it('sits just outside the block', () => {
    expect(outlineBox({ left: 40, top: 100, width: 400, height: 200 }, 2, room)).toEqual({
      left: 38,
      top: 98,
      width: 404,
      height: 204,
    })
  })

  it('stays within the canvas for a block against its edge, so every side shows', () => {
    expect(outlineBox({ left: 0, top: 0, width: 800, height: 50 }, 2, room)).toEqual({
      left: 3,
      top: 3,
      width: 794,
      height: 49,
    })
  })
})

describe('plusPlacement', () => {
  const room = { width: 390, height: 600 }

  it('sits just after the menu row, centred on it', () => {
    expect(plusPlacement({ left: 10, top: 40, width: 200, height: 30 }, room)).toEqual({
      left: 216,
      top: 43,
    })
  })

  it('stays inside the canvas when the row runs past its edge, as on a phone', () => {
    const place = plusPlacement({ left: 10, top: 40, width: 520, height: 30 }, room)
    expect(place.left).toBe(390 - 24 - 4)
  })

  it('stays inside the canvas when the row is scrolled above it', () => {
    expect(plusPlacement({ left: 10, top: -80, width: 200, height: 30 }, room).top).toBe(4)
  })

  it('never starts before the canvas', () => {
    expect(plusPlacement({ left: -40, top: 40, width: 10, height: 30 }, room).left).toBe(4)
  })
})
