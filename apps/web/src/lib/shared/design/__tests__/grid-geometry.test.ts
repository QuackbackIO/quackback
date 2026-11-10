/**
 * Home's grid as the frame draws it: cells from the measured tracks, rows
 * past the last drawn one a unit tall, and the cell nearest a point.
 */
import { describe, expect, it } from 'vitest'
import {
  columnAt,
  columnsTo,
  parseTracks,
  placeRect,
  rowAt,
  rowStart,
  rowsTo,
  type GridMetrics,
} from '../grid-geometry'

// Twelve columns of 60 with 20 between: 940 wide. Rows of 24, one grown to 100.
const grid: GridMetrics = {
  left: 100,
  top: 50,
  width: 940,
  columns: 12,
  columnGap: 20,
  rowGap: 16,
  rows: [24, 24, 100, 24],
  unit: 24,
}

describe('parseTracks', () => {
  it('reads computed track sizes', () => {
    expect(parseTracks('24px 56.5px 24px')).toEqual([24, 56.5, 24])
    expect(parseTracks('none')).toEqual([])
  })
})

describe('placeRect', () => {
  it('draws a place over the cells it takes, grown rows and all', () => {
    expect(placeRect(grid, { x: 1, y: 1, w: 2, h: 2 })).toEqual({
      left: 180,
      top: 90,
      width: 140,
      height: 140,
    })
  })

  it('reaches rows below the drawn ones at a unit each', () => {
    expect(rowStart(grid, 5)).toBe(40 + 40 + 116 + 40 + 40)
  })
})

describe('the cell nearest a point', () => {
  it('finds the column and row a block’s corner is nearest', () => {
    expect(columnAt(grid, 250)).toBe(3)
    expect(columnAt(grid, 900, 6)).toBe(6)
    expect(rowAt(grid, 70)).toBe(2)
    expect(rowAt(grid, 400)).toBe(8)
  })

  it('finds how many columns and rows reach an edge', () => {
    expect(columnsTo(grid, 0, 300)).toBe(4)
    expect(columnsTo(grid, 10, 2000)).toBe(2)
    expect(columnsTo(grid, 4, -50)).toBe(1)
    expect(rowsTo(grid, 0, 200)).toBe(3)
  })
})
