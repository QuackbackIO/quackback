/**
 * Turns a spreadsheet's bytes into display text for the grid. Runs inside
 * the sheet worker, never on the page: SheetJS reads workbooks (xlsx, xlsm,
 * xlsb, xls, ods), papaparse reads delimited text. Only formatted display
 * strings and formula text leave this module; no HTML is ever built
 * (`cellHTML: false`), formulas are shown and never evaluated, and macro
 * parts are never read.
 */
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { isZip, rebuildZipPackage } from './budgets'
import {
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
  cellRef,
  type CellKind,
  type CellRange,
  type SheetData,
  type SheetParseResult,
  type SheetSource,
} from './sheet-model'

export function parseSheets(buffer: ArrayBuffer, source: SheetSource): SheetParseResult {
  try {
    return source === 'workbook'
      ? parseWorkbook(new Uint8Array(buffer))
      : parseDelimited(new Uint8Array(buffer), source)
  } catch {
    return { ok: false, failure: 'corrupt' }
  }
}

// ---------------------------------------------------------------------------
// Workbooks

function parseWorkbook(file: Uint8Array): SheetParseResult {
  let bytes = file
  if (isZip(bytes)) {
    // SheetJS inflates a package's parts past their declared sizes, so it
    // only ever reads the package rebuilt from verified parts.
    const rebuilt = rebuildZipPackage(bytes)
    if (!rebuilt.ok) return rebuilt
    bytes = rebuilt.bytes
  }
  const wb = XLSX.read(bytes, {
    type: 'array',
    cellHTML: false,
    cellFormula: true,
    cellStyles: false,
    sheetRows: MAX_SHEET_ROWS + 1,
    dense: true,
  })
  if (wb.SheetNames.length === 0) return { ok: false, failure: 'corrupt' }
  return {
    ok: true,
    sheets: wb.SheetNames.map((name) => sheetFromWorksheet(name, wb.Sheets[name])),
  }
}

const KINDS: Record<string, CellKind> = { n: 'n', d: 'd', b: 'b', e: 'e', s: 's' }

function sheetFromWorksheet(name: string, ws: XLSX.WorkSheet | undefined): SheetData {
  const empty: SheetData = {
    name,
    rows: [],
    types: [],
    formulas: {},
    merges: [],
    colCount: 0,
    totalRows: 0,
    truncated: false,
  }
  const ref = ws?.['!ref']
  if (!ws || !ref) return empty

  const range = XLSX.utils.decode_range(ref)
  const fullRef = ws['!fullref']
  const full = typeof fullRef === 'string' ? XLSX.utils.decode_range(fullRef) : range
  const sheetRowCount = Math.max(range.e.r, full.e.r) + 1
  const rowCount = Math.min(range.e.r + 1, MAX_SHEET_ROWS)
  const colCount = Math.min(range.e.c + 1, MAX_SHEET_COLUMNS)
  const data = (ws['!data'] ?? []) as (XLSX.CellObject | undefined)[][]

  const rows: string[][] = []
  const types: string[] = []
  const formulas: Record<string, string> = {}
  for (let r = 0; r < rowCount; r++) {
    const source = data[r]
    const row = new Array<string>(colCount)
    let kinds = ''
    for (let c = 0; c < colCount; c++) {
      const cell = source?.[c]
      if (!cell || cell.t === 'z') {
        row[c] = ''
        kinds += ' '
        continue
      }
      row[c] = displayText(cell)
      kinds += KINDS[cell.t] ?? 's'
      if (typeof cell.f === 'string' && cell.f !== '') formulas[cellRef(r, c)] = `=${cell.f}`
    }
    rows.push(row)
    types.push(kinds)
  }

  return {
    name,
    rows,
    types,
    formulas,
    merges: clipMerges(ws['!merges'] ?? [], rowCount, colCount),
    colCount,
    totalRows: sheetRowCount,
    truncated: sheetRowCount > MAX_SHEET_ROWS || range.e.c + 1 > MAX_SHEET_COLUMNS,
  }
}

function displayText(cell: XLSX.CellObject): string {
  if (typeof cell.w === 'string') return cell.w
  if (cell.v == null) return ''
  try {
    return XLSX.utils.format_cell(cell)
  } catch {
    return String(cell.v)
  }
}

function clipMerges(merges: XLSX.Range[], rowCount: number, colCount: number): CellRange[] {
  return merges
    .filter((m) => m.s.r < rowCount && m.s.c < colCount)
    .map((m) => ({
      s: { r: m.s.r, c: m.s.c },
      e: { r: Math.min(m.e.r, rowCount - 1), c: Math.min(m.e.c, colCount - 1) },
    }))
}

// ---------------------------------------------------------------------------
// Delimited text

const NUMBER = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d+)?(?:[eE][-+]?\d+)?%?$/

function parseDelimited(bytes: Uint8Array, source: 'csv' | 'tsv'): SheetParseResult {
  const text = decodeText(bytes)
  const parsed = Papa.parse<string[]>(text, {
    preview: MAX_SHEET_ROWS + 1,
    delimiter: source === 'tsv' ? '\t' : '',
    skipEmptyLines: false,
  })
  const data = parsed.data
  // A file ending in a newline leaves one empty record behind.
  const last = data[data.length - 1]
  if (last && last.length === 1 && last[0] === '') data.pop()

  const read = Math.min(data.length, MAX_SHEET_ROWS)
  let widest = 0
  for (let r = 0; r < read; r++) widest = Math.max(widest, data[r]!.length)
  const colCount = Math.min(widest, MAX_SHEET_COLUMNS)

  const rows: string[][] = []
  const types: string[] = []
  for (let r = 0; r < read; r++) {
    const record = data[r]!
    const row = new Array<string>(colCount)
    let kinds = ''
    for (let c = 0; c < colCount; c++) {
      const value = record[c] ?? ''
      row[c] = value
      kinds += value === '' ? ' ' : /\d/.test(value) && NUMBER.test(value.trim()) ? 'n' : 's'
    }
    rows.push(row)
    types.push(kinds)
  }

  return {
    ok: true,
    sheets: [
      {
        name: 'Sheet1',
        rows,
        types,
        formulas: {},
        merges: [],
        colCount,
        totalRows: data.length,
        truncated: data.length > MAX_SHEET_ROWS || widest > MAX_SHEET_COLUMNS,
      },
    ],
  }
}

/** UTF-8 (or UTF-16 with a byte order mark), else the common Windows codepage. */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    // The UTF-8 decoder drops a leading byte order mark itself.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// ---------------------------------------------------------------------------
// Worker protocol

export interface SheetRequest {
  bytes: ArrayBuffer
  source: SheetSource
}

/** What the sheet worker does with one request; never throws. */
export function handleSheetRequest(request: SheetRequest): SheetParseResult {
  return parseSheets(request.bytes, request.source)
}
