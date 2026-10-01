/**
 * The shape a parsed sheet takes between the parsing worker and the grid,
 * and the small rules the grid applies to it. Kept free of any parsing
 * library so the grid's chunk never carries one.
 */
import type { IntlShape } from 'react-intl'
import { fileExtension } from '@/lib/shared/files/file-types'

/** Rows read per sheet; one more is read to learn whether the sheet goes on. */
export const MAX_SHEET_ROWS = 5_000
export const MAX_SHEET_COLUMNS = 200

export interface CellAddress {
  r: number
  c: number
}

export interface CellRange {
  s: CellAddress
  e: CellAddress
}

/**
 * A cell's kind, one character per column in `SheetData.types`:
 * `n` number, `d` date, `b` boolean, `e` error, `s` text, space for empty.
 */
export type CellKind = 'n' | 'd' | 'b' | 'e' | 's' | ' '

export interface SheetData {
  name: string
  /** Display text, row-major, every row `colCount` long. Never HTML. */
  rows: string[][]
  /** One string per row, one `CellKind` character per column. */
  types: string[]
  /** Formula text by A1 reference ("B5" -> "=SUM(B2:B4)"), shown, never run. */
  formulas: Record<string, string>
  merges: CellRange[]
  colCount: number
  /** Rows in the sheet when known, else the rows read. */
  totalRows: number
  /** True when rows or columns past the budget were left out. */
  truncated: boolean
}

export type SheetSource = 'csv' | 'tsv' | 'workbook'

/** Which parser reads a file: papaparse for delimited text, SheetJS for the rest. */
export function sheetSourceFor(name: string, contentType = ''): SheetSource {
  const ext = fileExtension(name)
  if (ext === 'tsv' || contentType === 'text/tab-separated-values') return 'tsv'
  if (ext === 'csv' || contentType === 'text/csv') return 'csv'
  return 'workbook'
}

export type SheetParseResult =
  { ok: true; sheets: SheetData[] } | { ok: false; failure: 'corrupt' | 'too_large' }

/** True when no cell of the sheet holds any text. */
export function isEmptySheet(sheet: Pick<SheetData, 'rows'>): boolean {
  return sheet.rows.every((row) => row.every((value) => value === ''))
}

/** "A", "Z", "AA", "ZZ", "AAA" for 0-based column indexes. */
export function columnLabel(index: number): string {
  let label = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/** "B5" for row 4, column 1 (both 0-based). */
export function cellRef(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`
}

/**
 * Whether the first row reads as column titles: at least half the columns
 * filled, all with distinct text, and data below it.
 */
export function looksLikeHeader(sheet: SheetData): boolean {
  const [first, second] = sheet.rows
  if (!first || !second) return false
  const kinds = sheet.types[0] ?? ''
  const filled = first.filter((v, c) => v.trim() !== '' && kinds[c] !== ' ')
  if (filled.length === 0 || filled.length < Math.ceil(sheet.colCount / 2)) return false
  if (first.some((v, c) => v.trim() !== '' && kinds[c] !== 's')) return false
  return new Set(filled.map((v) => v.trim().toLowerCase())).size === filled.length
}

/** The viewer's quiet note for a sheet: "1,248 rows" or "First 5,000 rows". */
export function rowsNote(
  sheet: Pick<SheetData, 'totalRows' | 'truncated'>,
  intl: IntlShape
): string {
  if (sheet.truncated) {
    return intl.formatMessage(
      {
        id: 'files.sheet.truncatedRows',
        defaultMessage: 'First {count, plural, one {# row} other {# rows}}',
      },
      { count: MAX_SHEET_ROWS }
    )
  }
  return intl.formatMessage(
    { id: 'files.count.rows', defaultMessage: '{count, plural, one {# row} other {# rows}}' },
    { count: sheet.totalRows }
  )
}

const MIN_COLUMN_PX = 64
const MAX_COLUMN_PX = 320
const CHAR_PX = 8
const CELL_PADDING_PX = 20
/** Rows sampled to size columns; enough to see the shape without reading 5,000. */
const WIDTH_SAMPLE_ROWS = 200

/** A width per column from its longest text in the first rows. */
export function columnWidths(sheet: Pick<SheetData, 'rows' | 'colCount'>): number[] {
  const longest = new Array<number>(sheet.colCount).fill(0)
  const sample = sheet.rows.slice(0, WIDTH_SAMPLE_ROWS)
  for (const row of sample) {
    for (let c = 0; c < sheet.colCount; c++) {
      const len = row[c]?.length ?? 0
      if (len > longest[c]!) longest[c] = len
    }
  }
  return longest.map((len) =>
    Math.round(Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, len * CHAR_PX + CELL_PADDING_PX)))
  )
}

/** Right-align numbers and dates, centre booleans and errors, as spreadsheets do. */
export function cellAlign(kind: string | undefined): 'left' | 'right' | 'center' {
  if (kind === 'n' || kind === 'd') return 'right'
  if (kind === 'b' || kind === 'e') return 'center'
  return 'left'
}
