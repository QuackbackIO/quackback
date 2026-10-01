import { describe, expect, it } from 'vitest'
import {
  cellRef,
  columnLabel,
  columnWidths,
  looksLikeHeader,
  rowsNote,
  type SheetData,
} from '../sheet-model'

function sheet(rows: string[][], types?: string[]): SheetData {
  return {
    name: 'Sheet1',
    rows,
    types: types ?? rows.map((r) => r.map((v) => (v === '' ? ' ' : 's')).join('')),
    formulas: {},
    merges: [],
    colCount: Math.max(0, ...rows.map((r) => r.length)),
    totalRows: rows.length,
    truncated: false,
  }
}

describe('columnLabel', () => {
  it('names columns the way spreadsheets do', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(51)).toBe('AZ')
    expect(columnLabel(701)).toBe('ZZ')
    expect(columnLabel(702)).toBe('AAA')
  })
})

describe('cellRef', () => {
  it('joins the column letters and the 1-based row', () => {
    expect(cellRef(4, 1)).toBe('B5')
    expect(cellRef(0, 0)).toBe('A1')
    expect(cellRef(99, 27)).toBe('AB100')
  })
})

describe('looksLikeHeader', () => {
  it('treats a first row of distinct labels over data as a header', () => {
    const s = sheet(
      [
        ['Name', 'Plan', 'Seats'],
        ['Acme', 'Pro', '12'],
      ],
      ['sss', 'ssn']
    )
    expect(looksLikeHeader(s)).toBe(true)
  })

  it('does not when the first row holds numbers', () => {
    const s = sheet(
      [
        ['2024', 'Pro', '12'],
        ['2025', 'Pro', '14'],
      ],
      ['nsn', 'nsn']
    )
    expect(looksLikeHeader(s)).toBe(false)
  })

  it('does not when the first row is mostly empty', () => {
    const s = sheet(
      [
        ['Quarterly report', '', '', ''],
        ['a', 'b', 'c', 'd'],
      ],
      ['s   ', 'ssss']
    )
    expect(looksLikeHeader(s)).toBe(false)
  })

  it('does not when labels repeat', () => {
    const s = sheet(
      [
        ['x', 'x', 'x'],
        ['1', '2', '3'],
      ],
      ['sss', 'nnn']
    )
    expect(looksLikeHeader(s)).toBe(false)
  })

  it('does not for a single row', () => {
    expect(looksLikeHeader(sheet([['Name', 'Plan']]))).toBe(false)
  })
})

describe('rowsNote', () => {
  it('counts rows with a thousands separator', () => {
    expect(rowsNote({ totalRows: 1248, truncated: false })).toBe('1,248 rows')
    expect(rowsNote({ totalRows: 1, truncated: false })).toBe('1 row')
    expect(rowsNote({ totalRows: 0, truncated: false })).toBe('0 rows')
  })

  it('says only the first rows show when the sheet was cut', () => {
    expect(rowsNote({ totalRows: 80_000, truncated: true })).toBe('First 5,000 rows')
  })
})

describe('columnWidths', () => {
  it('sizes columns from their longest text, within bounds', () => {
    const s = sheet([
      ['id', 'A much longer description of the row'],
      ['1', 'short'],
    ])
    const [narrow, wide] = columnWidths(s)
    expect(narrow).toBe(64)
    expect(wide).toBeGreaterThan(200)
    expect(wide).toBeLessThanOrEqual(320)
  })

  it('caps a column of very long text', () => {
    const s = sheet([['x'.repeat(5000)]])
    expect(columnWidths(s)).toEqual([320])
  })
})
