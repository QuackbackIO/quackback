/**
 * Workbooks (.xlsx, .xlsm, .xls, .ods): sheet names, the first sheet's row
 * count and first rows. The sheet parser inflates every part of a zip
 * container itself, so the archive must pass the zip budget and prove its
 * declared sizes first; it then reads only the first sheet, and only its
 * first rows, with formulas, styles and HTML off.
 */
import { openZip, verifyZipSizes } from '@/lib/server/content/zip-budget'
import {
  NO_DEADLINE,
  cell,
  cleanText,
  clip,
  loadDependency,
  normalizeExcerpt,
  type Deadline,
  type PreviewResult,
} from './result'

const HEAD_ROWS = 6
const HEAD_COLUMNS = 8
const CELL_CHARS = 40
/** Rows of the first sheet that are parsed: a header plus the excerpt's rows. */
const PARSED_ROWS = 201
/** Columns the excerpt carries. */
const EXCERPT_COLUMNS = 50
const MAX_SHEET_NAMES = 100
const SHEET_NAME_CHARS = 100

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

export async function deriveSpreadsheetPreview(
  bytes: Uint8Array,
  _contentType: string,
  deadline: Pick<Deadline, 'check'> = NO_DEADLINE
): Promise<PreviewResult> {
  if (isZip(bytes)) verifyZipSizes(bytes, openZip(bytes).entries)
  deadline.check()

  const XLSX = await loadDependency('xlsx', async () => (await import('xlsx')).default)
  const workbook = XLSX.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    type: 'buffer',
    sheets: 0,
    sheetRows: PARSED_ROWS,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
  })
  deadline.check()

  const sheets = workbook.SheetNames.slice(0, MAX_SHEET_NAMES).map((name) =>
    clip(cleanText(name), SHEET_NAME_CHARS)
  )
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!sheet?.['!ref']) return { status: 'ready', meta: sheets.length ? { sheets } : {} }

  // A truncated read keeps the sheet's real extent in `!fullref`.
  const full = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'])
  const rows = full.e.r - full.s.r + 1

  // The parsed range can still claim thousands of columns; read a window.
  const parsed = XLSX.utils.decode_range(sheet['!ref'])
  parsed.e.c = Math.min(parsed.e.c, parsed.s.c + EXCERPT_COLUMNS - 1)
  sheet['!ref'] = XLSX.utils.encode_range(parsed)

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  const head = grid
    .slice(0, HEAD_ROWS)
    .map((row) => row.slice(0, HEAD_COLUMNS).map((v) => cell(v, CELL_CHARS)))
  const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: true })

  return {
    status: 'ready',
    meta: {
      ...(sheets.length ? { sheets } : {}),
      ...(rows > 0 ? { rows } : {}),
      ...(head.length ? { head } : {}),
    },
    excerpt: normalizeExcerpt(csv),
  }
}
