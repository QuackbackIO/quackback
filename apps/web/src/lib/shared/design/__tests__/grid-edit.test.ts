/**
 * Moving and resizing a picked Home block from the keyboard, and what is
 * said after: arrows move it a cell, Shift and arrows resize it, each change
 * written into the design with the rest laid out around it, in reading order.
 */
import { describe, expect, it } from 'vitest'
import { editGrid, movedWords, resizedWords, stepOfKey } from '../grid-edit'
import { newBlock } from '../home'
import { defaultDesign } from '../schema'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function design() {
  const doc = defaultDesign()
  doc.pages.home.blocks = [
    { ...newBlock('ideas', { x: 0, y: 0, w: 6, h: 8 }), id: 'ideas0001' },
    { ...newBlock('updates', { x: 6, y: 0, w: 6, h: 8 }), id: 'updates01' },
    { ...newBlock('roadmap', { x: 0, y: 8, w: 12, h: 6 }), id: 'roadmap01' },
  ]
  return doc
}
const placeOf = (doc: ReturnType<typeof design>, id: string) =>
  doc.pages.home.blocks.find((block) => block.id === id)!.grid

describe('stepOfKey', () => {
  it('moves with the arrows and resizes with Shift and the arrows', () => {
    expect(stepOfKey({ key: 'ArrowLeft' })).toBe('left')
    expect(stepOfKey({ key: 'ArrowDown' })).toBe('down')
    expect(stepOfKey({ key: 'ArrowRight', shiftKey: true })).toBe('wider')
    expect(stepOfKey({ key: 'ArrowLeft', shiftKey: true })).toBe('narrower')
    expect(stepOfKey({ key: 'ArrowDown', shiftKey: true })).toBe('taller')
    expect(stepOfKey({ key: 'ArrowUp', shiftKey: true })).toBe('shorter')
  })

  it('leaves other keys and arrows with Ctrl, Alt or Cmd alone', () => {
    expect(stepOfKey({ key: 'a' })).toBeNull()
    expect(stepOfKey({ key: 'ArrowUp', ctrlKey: true })).toBeNull()
    expect(stepOfKey({ key: 'ArrowUp', altKey: true })).toBeNull()
    expect(stepOfKey({ key: 'ArrowUp', metaKey: true })).toBeNull()
  })
})

describe('editGrid', () => {
  it('moves the picked block below the one under it, which rises into its room', () => {
    const doc = design()
    const place = editGrid(doc, ALL_ON, 'ideas0001', { nudge: 'down' })
    expect(place).toEqual({ x: 0, y: 14, w: 6, h: 8 })
    // Latest updates still stands beside it, so the roadmap can rise only to under that.
    expect(placeOf(doc, 'roadmap01')).toEqual({ x: 0, y: 8, w: 12, h: 6 })
    expect(doc.pages.home.blocks.map((block) => block.id)).toEqual([
      'updates01',
      'roadmap01',
      'ideas0001',
    ])
  })

  it('resizes the picked block, pushing what is in its way down', () => {
    const doc = design()
    expect(editGrid(doc, ALL_ON, 'ideas0001', { nudge: 'wider' })).toEqual({
      x: 0,
      y: 0,
      w: 7,
      h: 8,
    })
    expect(placeOf(doc, 'updates01')).toEqual({ x: 6, y: 8, w: 6, h: 8 })
  })

  it('moves and resizes to a cell, as a drag does', () => {
    const doc = design()
    editGrid(doc, ALL_ON, 'ideas0001', { move: { x: 0, y: 20 } })
    expect(placeOf(doc, 'ideas0001')).toEqual({ x: 0, y: 14, w: 6, h: 8 })
    editGrid(doc, ALL_ON, 'ideas0001', { size: { w: 12, h: 10 } })
    expect(placeOf(doc, 'ideas0001')).toEqual({ x: 0, y: 14, w: 12, h: 10 })
  })

  it('changes nothing, and says so, at an edge or at the least size', () => {
    const doc = design()
    const before = structuredClone(doc)
    expect(editGrid(doc, ALL_ON, 'ideas0001', { nudge: 'left' })).toBeNull()
    expect(editGrid(doc, ALL_ON, 'ideas0001', { nudge: 'up' })).toBeNull()
    expect(doc).toEqual(before)
  })

  it('lays out only the blocks Home shows', () => {
    const doc = design()
    // With the changelog off, Latest updates is not drawn, so Top posts takes its room
    // (no hole beside it), and a change to it keeps that width.
    editGrid(doc, { ...ALL_ON, changelog: false }, 'ideas0001', { size: { w: 12, h: 10 } })
    expect(placeOf(doc, 'ideas0001')).toEqual({ x: 0, y: 0, w: 12, h: 10 })
    expect(placeOf(doc, 'updates01')).toEqual({ x: 6, y: 0, w: 6, h: 8 })
  })
})

describe('what is said', () => {
  it('names the row and column a block moved to, and its new size, counting from one', () => {
    expect(movedWords('Top posts', { x: 6, y: 2, w: 6, h: 8 })).toBe(
      'Top posts moved to row 3, column 7.'
    )
    expect(resizedWords('Top posts', { x: 0, y: 0, w: 6, h: 1 })).toBe(
      'Top posts resized to 6 columns by 1 row.'
    )
  })
})
