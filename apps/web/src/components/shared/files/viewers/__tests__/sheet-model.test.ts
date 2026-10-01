import { describe, expect, it } from 'vitest'
import { createIntl } from 'react-intl'
import { MAX_FIND_MATCHES } from '../find-limit'
import {
  cellRef,
  columnLabel,
  columnWidths,
  findCells,
  looksLikeHeader,
  rowsNote,
  type SheetData,
} from '../sheet-model'

const intl = createIntl({ locale: 'en-US', messages: {} })

function sheet(rows: string[][], types?: string[]): SheetData {
  return {
    name: 'Sheet1',
    rows,
    types: types ?? rows.map((r) => r.map((v) => (v === '' ? ' ' : 's')).join('')),
    formulas: {},
    merges: [],
    colCount: Math.max(0, ...rows.map((r) => r.length)),
    totalRows: rows.length,
    rowsTruncated: false,
    columnsTruncated: false,
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

const whole = { rowsTruncated: false, columnsTruncated: false }

describe('rowsNote', () => {
  it('counts rows with a thousands separator', () => {
    expect(rowsNote({ ...whole, totalRows: 1248 }, intl)).toBe('1,248 rows')
    expect(rowsNote({ ...whole, totalRows: 1 }, intl)).toBe('1 row')
    expect(rowsNote({ ...whole, totalRows: 0 }, intl)).toBe('0 rows')
  })

  it('says only the first rows show when the sheet was cut', () => {
    expect(rowsNote({ ...whole, totalRows: 80_000, rowsTruncated: true }, intl)).toBe(
      'First 2,000 rows'
    )
  })

  it('says when columns were left out, and only then', () => {
    expect(rowsNote({ ...whole, totalRows: 40, columnsTruncated: true }, intl)).toBe(
      '40 rows · First 100 columns'
    )
    expect(rowsNote({ totalRows: 80_000, rowsTruncated: true, columnsTruncated: true }, intl)).toBe(
      'First 2,000 rows · First 100 columns'
    )
  })

  it('renders in German when the viewer locale is German', () => {
    const de = createIntl({
      locale: 'de',
      messages: {
        'files.count.rows': '{count, plural, one {# Zeile} other {# Zeilen}}',
        'files.sheet.truncatedRows': 'Erste {count, plural, one {# Zeile} other {# Zeilen}}',
      },
    })
    expect(rowsNote({ ...whole, totalRows: 1248 }, de)).toBe('1.248 Zeilen')
    expect(rowsNote({ ...whole, totalRows: 80_000, rowsTruncated: true }, de)).toBe(
      'Erste 2.000 Zeilen'
    )
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

describe('findCells', () => {
  it('finds display text in any case, row by row, ignoring a blank query', () => {
    const s = sheet([
      ['Name', 'Plan'],
      ['acme', 'Pro'],
      ['', 'ACME Pro'],
    ])
    expect(findCells(s, 'Acme')).toEqual([
      { r: 1, c: 0 },
      { r: 2, c: 1 },
    ])
    expect(findCells(s, '  ')).toEqual([])
  })

  it('stops counting where every other find does', () => {
    const s = sheet(Array.from({ length: 200 }, () => Array.from({ length: 60 }, () => 'x')))
    expect(findCells(s, 'x')).toHaveLength(MAX_FIND_MATCHES)
  })
})
