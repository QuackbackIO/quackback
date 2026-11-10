/**
 * Home's grid: twelve columns of rows a fixed unit tall. Blocks float up to
 * fill gaps; a block moved or resized onto others pushes them down (or, moved
 * down past one, lets it rise into the place it left); nothing leaves the
 * grid or goes under its type's least size. Old designs' widths become places
 * in their old order, and phones read the blocks top to bottom, left to right.
 */
import { describe, expect, it } from 'vitest'
import {
  collides,
  compact,
  flowLayout,
  GRID_COLUMNS,
  moveItem,
  nudge,
  packWidths,
  readingOrder,
  resizeItem,
  settle,
  type GridItem,
} from '../home-grid'

const item = (id: string, x: number, y: number, w: number, h: number, min?: [number, number]) =>
  ({ id, x, y, w, h, ...(min && { minW: min[0], minH: min[1] }) }) as GridItem

/** Each item's place, by id, so a test reads the layout at a glance. */
const places = (items: readonly GridItem[]) =>
  Object.fromEntries(items.map(({ id, x, y, w, h }) => [id, [x, y, w, h]]))

const overlapFree = (items: readonly GridItem[]) =>
  items.every((a, i) => items.every((b, j) => i === j || !collides(a, b)))

describe('collides', () => {
  it('is true only when two boxes share a cell', () => {
    expect(collides(item('a', 0, 0, 6, 4), item('b', 5, 3, 2, 2))).toBe(true)
    expect(collides(item('a', 0, 0, 6, 4), item('b', 6, 0, 6, 4))).toBe(false)
    expect(collides(item('a', 0, 0, 6, 4), item('b', 0, 4, 6, 4))).toBe(false)
  })
})

describe('compact', () => {
  it('floats blocks up to fill the gaps above them', () => {
    const out = compact([item('a', 0, 3, 6, 4), item('b', 6, 9, 6, 2), item('c', 0, 12, 12, 2)])
    expect(places(out)).toEqual({ a: [0, 0, 6, 4], b: [6, 0, 6, 2], c: [0, 4, 12, 2] })
  })

  it('does not jump a block over another in its way', () => {
    const out = compact([item('a', 0, 0, 12, 2), item('b', 0, 5, 4, 2)])
    expect(places(out).b).toEqual([0, 2, 4, 2])
  })

  it('keeps the order given', () => {
    const out = compact([item('z', 0, 4, 12, 2), item('a', 0, 0, 12, 2)])
    expect(out.map((one) => one.id)).toEqual(['z', 'a'])
  })
})

describe('settle', () => {
  it('pushes overlapping blocks down, keeps them in the grid and at their least size', () => {
    const out = settle([
      item('a', 0, 0, 12, 4),
      item('b', 2, 1, 6, 1, [4, 3]),
      item('c', 10, 0, 6, 2),
    ])
    expect(overlapFree(out)).toBe(true)
    expect(places(out)).toEqual({ a: [0, 0, 12, 4], c: [6, 4, 6, 2], b: [2, 6, 6, 3] })
  })
})

describe('moveItem', () => {
  const two = () => [item('a', 0, 0, 6, 4), item('b', 6, 0, 6, 4), item('c', 0, 4, 12, 3)]

  it('moves a block under another, the rest floating up behind it', () => {
    const out = moveItem(two(), 'a', 0, 7)
    // c, full width, cannot rise past b, so a goes under c.
    expect(places(out)).toEqual({ a: [0, 7, 6, 4], b: [6, 0, 6, 4], c: [0, 4, 12, 3] })
  })

  it('pushes a block in the way down', () => {
    const out = moveItem(two(), 'c', 0, 0)
    expect(places(out)).toEqual({ c: [0, 0, 12, 3], a: [0, 3, 6, 4], b: [6, 3, 6, 4] })
  })

  it('lets a block it is moved down past rise into the place it left', () => {
    const items = [item('a', 0, 0, 12, 4), item('b', 0, 4, 12, 4)]
    expect(places(moveItem(items, 'a', 0, 4))).toEqual({ a: [0, 4, 12, 4], b: [0, 0, 12, 4] })
  })

  it('keeps a block inside the grid', () => {
    const out = moveItem(two(), 'a', 10, -3)
    expect(places(out).a).toEqual([6, 0, 6, 4])
    expect(overlapFree(out)).toBe(true)
  })

  it('changes nothing for an unknown block', () => {
    const items = two()
    expect(moveItem(items, 'zz', 3, 3)).toEqual(items)
  })

  it('never leaves blocks overlapping', () => {
    const items = [
      item('a', 0, 0, 4, 6),
      item('b', 4, 0, 8, 3),
      item('c', 4, 3, 4, 5),
      item('d', 8, 3, 4, 2),
      item('e', 0, 8, 12, 2),
    ]
    for (let x = 0; x < GRID_COLUMNS; x++)
      for (let y = 0; y < 12; y++)
        for (const id of ['a', 'b', 'c', 'd', 'e'])
          expect(overlapFree(moveItem(items, id, x, y))).toBe(true)
  })
})

describe('resizeItem', () => {
  it('grows a block wider, pushing a neighbour down', () => {
    const out = resizeItem([item('a', 0, 0, 6, 4), item('b', 6, 0, 6, 4)], 'a', 8, 4)
    expect(places(out)).toEqual({ a: [0, 0, 8, 4], b: [6, 4, 6, 4] })
  })

  it('grows a block taller, pushing what is under it down', () => {
    const out = resizeItem([item('a', 0, 0, 6, 4), item('b', 0, 4, 6, 2)], 'a', 6, 7)
    expect(places(out)).toEqual({ a: [0, 0, 6, 7], b: [0, 7, 6, 2] })
  })

  it('lets what is under a shorter block float up', () => {
    const out = resizeItem([item('a', 0, 0, 6, 6), item('b', 0, 6, 6, 2)], 'a', 6, 4)
    expect(places(out).b).toEqual([0, 4, 6, 2])
  })

  it('keeps its least size and the grid’s right edge', () => {
    const items = [item('a', 4, 0, 6, 8, [4, 6])]
    expect(places(resizeItem(items, 'a', 2, 3)).a).toEqual([4, 0, 4, 6])
    expect(places(resizeItem(items, 'a', 12, 8)).a).toEqual([4, 0, 8, 8])
  })
})

describe('nudge', () => {
  const items = () => [item('a', 0, 0, 6, 4), item('b', 6, 0, 6, 4), item('c', 0, 4, 12, 3)]

  it('moves a block one column sideways', () => {
    expect(nudge(items(), 'c', 'right')).toBeNull()
    const out = nudge([item('a', 0, 0, 6, 4)], 'a', 'right')
    expect(places(out!).a).toEqual([1, 0, 6, 4])
  })

  it('moves a block above the one over it', () => {
    const out = nudge(items(), 'c', 'up')
    expect(places(out!)).toEqual({ c: [0, 0, 12, 3], a: [0, 3, 6, 4], b: [6, 3, 6, 4] })
  })

  it('moves a block below the one under it', () => {
    const out = nudge([item('a', 0, 0, 12, 4), item('b', 0, 4, 12, 2)], 'a', 'down')
    expect(places(out!)).toEqual({ a: [0, 2, 12, 4], b: [0, 0, 12, 2] })
  })

  it('resizes by a cell with grow and shrink', () => {
    const one = [item('a', 0, 0, 6, 4, [4, 3])]
    expect(places(nudge(one, 'a', 'wider')!).a).toEqual([0, 0, 7, 4])
    expect(places(nudge(one, 'a', 'narrower')!).a).toEqual([0, 0, 5, 4])
    expect(places(nudge(one, 'a', 'taller')!).a).toEqual([0, 0, 6, 5])
    expect(places(nudge(one, 'a', 'shorter')!).a).toEqual([0, 0, 6, 3])
  })

  it('says nothing changed at an edge or at the least size', () => {
    expect(nudge([item('a', 0, 0, 6, 4)], 'a', 'left')).toBeNull()
    expect(nudge([item('a', 0, 0, 6, 4)], 'a', 'up')).toBeNull()
    expect(nudge([item('a', 0, 0, 6, 4)], 'a', 'down')).toBeNull()
    expect(nudge([item('a', 6, 0, 6, 4)], 'a', 'right')).toBeNull()
    expect(nudge([item('a', 0, 0, 4, 3, [4, 3])], 'a', 'narrower')).toBeNull()
    expect(nudge([item('a', 0, 0, 4, 3, [4, 3])], 'a', 'shorter')).toBeNull()
    expect(nudge([item('a', 0, 0, 12, 3)], 'a', 'wider')).toBeNull()
  })
})

describe('packWidths', () => {
  it('packs old widths left to right, top to bottom, at their old shares of twelve', () => {
    const out = packWidths([
      { id: 'a', w: 12, h: 3 },
      { id: 'b', w: 8, h: 2 },
      { id: 'c', w: 4, h: 4 },
      { id: 'd', w: 6, h: 8 },
      { id: 'e', w: 6, h: 7 },
    ])
    // A row's blocks share its tallest height, as the old rows did.
    expect(places(out)).toEqual({
      a: [0, 0, 12, 3],
      b: [0, 3, 8, 4],
      c: [8, 3, 4, 4],
      d: [0, 7, 6, 8],
      e: [6, 7, 6, 8],
    })
  })

  it('grows a row’s last block to the row’s end, as the old rows did', () => {
    const out = packWidths([
      { id: 'a', w: 8, h: 2 },
      { id: 'b', w: 4, h: 2 },
      { id: 'c', w: 6, h: 2 },
      { id: 'd', w: 8, h: 2 },
    ])
    expect(places(out)).toEqual({
      a: [0, 0, 8, 2],
      b: [8, 0, 4, 2],
      c: [0, 2, 12, 2],
      d: [0, 4, 12, 2],
    })
  })

  it('starts under the rows given', () => {
    expect(places(packWidths([{ id: 'a', w: 4, h: 2 }], 9)).a).toEqual([0, 9, 12, 2])
  })
})

describe('readingOrder', () => {
  it('reads rows top to bottom, each left to right', () => {
    const out = readingOrder([
      item('c', 0, 4, 12, 2),
      item('b', 6, 0, 6, 2),
      item('a', 0, 0, 6, 4),
      item('d', 6, 2, 6, 2),
    ])
    expect(out.map((one) => one.id)).toEqual(['a', 'b', 'd', 'c'])
  })
})

describe('flowLayout', () => {
  it('lays blocks out in reading order on fewer columns, wide ones across', () => {
    const out = flowLayout(
      [item('a', 0, 0, 8, 2), item('b', 8, 0, 4, 2), item('c', 0, 2, 6, 6), item('d', 6, 2, 6, 3)],
      2
    )
    expect(places(out)).toEqual({
      a: [0, 0, 2, 2],
      b: [0, 2, 1, 2],
      c: [1, 2, 1, 6],
      d: [0, 4, 1, 3],
    })
    expect(overlapFree(out)).toBe(true)
  })

  it('stacks every block in one column for a phone', () => {
    const out = flowLayout([item('b', 6, 0, 6, 2), item('a', 0, 0, 6, 4)], 1)
    expect(places(out)).toEqual({ a: [0, 0, 1, 4], b: [0, 4, 1, 2] })
  })
})
