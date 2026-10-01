import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { strToU8, zipSync } from 'fflate'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, sheetSourceFor } from '../sheet-model'
import { handleSheetRequest, parseSheets } from '../sheet-parse'
import { declareSize, deferSizes } from './zip-fixtures'

type BookType = 'xlsx' | 'xls' | 'ods' | 'xlsb'

function book(sheets: Record<string, XLSX.WorkSheet>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

function bytesOf(wb: XLSX.WorkBook, bookType: BookType = 'xlsx'): ArrayBuffer {
  const out = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
  return out
}

function ok(result: ReturnType<typeof parseSheets>) {
  if (!result.ok) throw new Error(`expected sheets, got ${result.failure}`)
  return result.sheets
}

function invoiceSheet(): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Item', 'Amount', 'Share'],
    ['Seats', 1234.5, 0.25],
    ['Support', 99, 0.75],
  ])
  ws['B2']!.z = '#,##0.00'
  ws['C2']!.z = '0%'
  ws['C3']!.z = '0%'
  ws['B4'] = { t: 'n', f: 'SUM(B2:B3)', v: 1333.5, z: '#,##0.00' }
  ws['A4'] = { t: 's', v: 'Total' }
  ws['A6'] = { t: 's', v: 'Paid in full' }
  ws['!ref'] = 'A1:C6'
  ws['!merges'] = [{ s: { r: 5, c: 0 }, e: { r: 5, c: 2 } }]
  return ws
}

describe('parseSheets: workbooks', () => {
  it('shows formatted values, surfaces formulas as text, and keeps merges', () => {
    const [s] = ok(parseSheets(bytesOf(book({ Invoice: invoiceSheet() })), 'workbook'))
    expect(s!.name).toBe('Invoice')
    expect(s!.rows[0]).toEqual(['Item', 'Amount', 'Share'])
    expect(s!.rows[1]).toEqual(['Seats', '1,234.50', '25%'])
    expect(s!.rows[3]).toEqual(['Total', '1,333.50', ''])
    expect(s!.rows[5]).toEqual(['Paid in full', '', ''])
    expect(s!.formulas).toEqual({ B4: '=SUM(B2:B3)' })
    expect(s!.merges).toEqual([{ s: { r: 5, c: 0 }, e: { r: 5, c: 2 } }])
    expect(s!.types[1]).toBe('snn')
    expect(s!.types[4]).toBe('   ')
    expect(s!.totalRows).toBe(6)
    expect(s!.colCount).toBe(3)
    expect(s!.truncated).toBe(false)
  })

  it('keeps every sheet in order', () => {
    const wb = book({
      Summary: XLSX.utils.aoa_to_sheet([['a']]),
      Articles: XLSX.utils.aoa_to_sheet([['b']]),
      Redirects: XLSX.utils.aoa_to_sheet([['c']]),
    })
    expect(ok(parseSheets(bytesOf(wb), 'workbook')).map((s) => s.name)).toEqual([
      'Summary',
      'Articles',
      'Redirects',
    ])
  })

  it(`reads the first ${MAX_SHEET_ROWS} rows and marks the sheet truncated`, () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS + 2 }, (_, i) => [`row ${i + 1}`, i + 1])
    const [s] = ok(parseSheets(bytesOf(book({ Big: XLSX.utils.aoa_to_sheet(rows) })), 'workbook'))
    expect(s!.rows).toHaveLength(MAX_SHEET_ROWS)
    expect(s!.rows[MAX_SHEET_ROWS - 1]).toEqual([`row ${MAX_SHEET_ROWS}`, `${MAX_SHEET_ROWS}`])
    expect(s!.truncated).toBe(true)
    expect(s!.totalRows).toBe(MAX_SHEET_ROWS + 2)
  })

  it('does not mark a sheet of exactly the row budget as truncated', () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS }, (_, i) => [i])
    const [s] = ok(parseSheets(bytesOf(book({ Full: XLSX.utils.aoa_to_sheet(rows) })), 'workbook'))
    expect(s!.rows).toHaveLength(MAX_SHEET_ROWS)
    expect(s!.truncated).toBe(false)
  })

  it(`keeps the first ${MAX_SHEET_COLUMNS} columns and marks the sheet truncated`, () => {
    const wide = [Array.from({ length: MAX_SHEET_COLUMNS + 5 }, (_, i) => `c${i}`)]
    const [s] = ok(parseSheets(bytesOf(book({ Wide: XLSX.utils.aoa_to_sheet(wide) })), 'workbook'))
    expect(s!.colCount).toBe(MAX_SHEET_COLUMNS)
    expect(s!.rows[0]).toHaveLength(MAX_SHEET_COLUMNS)
    expect(s!.truncated).toBe(true)
  })

  it('never carries rich-text HTML or link targets, only the display text', () => {
    const ws = XLSX.utils.aoa_to_sheet([['<img src=x onerror=alert(1)>', 'Docs']])
    ws['B1']!.l = { Target: 'javascript:alert(1)', Tooltip: 'x' }
    const [s] = ok(parseSheets(bytesOf(book({ S: ws })), 'workbook'))
    expect(s!.rows[0]).toEqual(['<img src=x onerror=alert(1)>', 'Docs'])
    expect(JSON.stringify(s)).not.toContain('javascript:')
  })

  it.each<BookType>(['xls', 'ods', 'xlsb'])('reads %s workbooks', (bookType) => {
    const [s] = ok(parseSheets(bytesOf(book({ Data: invoiceSheet() }), bookType), 'workbook'))
    expect(s!.name).toBe('Data')
    expect(s!.rows[0]).toEqual(['Item', 'Amount', 'Share'])
    expect(s!.rows[2]![0]).toBe('Support')
    expect(Number(s!.rows[2]![1])).toBe(99)
  })

  it('refuses a zip package over the index budget before parsing it', () => {
    const files: Record<string, Uint8Array> = { '[Content_Types].xml': strToU8('<Types/>') }
    for (let i = 0; i < 2001; i++) files[`xl/media/${i}.bin`] = strToU8('x')
    const zip = zipSync(files, { level: 1 })
    expect(parseSheets(zip.buffer as ArrayBuffer, 'workbook')).toEqual({
      ok: false,
      failure: 'too_large',
    })
  })

  it('refuses a workbook whose sheet inflates past the size its headers declare', () => {
    const rows = Array.from({ length: 500 }, (_, i) => [`row ${i}`, i])
    const zip = new Uint8Array(bytesOf(book({ Big: XLSX.utils.aoa_to_sheet(rows) })))
    const lying = declareSize(zip, 'xl/worksheets/sheet1.xml', 64)
    expect(parseSheets(lying.buffer as ArrayBuffer, 'workbook')).toEqual({
      ok: false,
      failure: 'corrupt',
    })
  })

  it('refuses a workbook whose local header disagrees with its index', () => {
    const zip = new Uint8Array(bytesOf(book({ Invoice: invoiceSheet() })))
    const lying = declareSize(zip, 'xl/worksheets/sheet1.xml', 1_000_000, 'local')
    expect(parseSheets(lying.buffer as ArrayBuffer, 'workbook')).toEqual({
      ok: false,
      failure: 'corrupt',
    })
  })

  it('reads a workbook whose sizes sit in data descriptors', () => {
    const zip = new Uint8Array(bytesOf(book({ Invoice: invoiceSheet() })))
    const streamed = deferSizes(zip, 'xl/worksheets/sheet1.xml')
    const [s] = ok(parseSheets(streamed.buffer as ArrayBuffer, 'workbook'))
    expect(s!.rows[0]).toEqual(['Item', 'Amount', 'Share'])
  })

  it('reports damaged packages as corrupt', () => {
    const bytes = strToU8('PK\u0003\u0004 this is not really a workbook')
    expect(parseSheets(bytes.buffer as ArrayBuffer, 'workbook')).toEqual({
      ok: false,
      failure: 'corrupt',
    })
  })
})

describe('parseSheets: delimited text', () => {
  it('splits CSV with quoted fields and marks numbers', () => {
    const csv = 'name,amount,note\n"Acme, Inc",12.5,"said ""hi"""\nGlobex,-3,\n'
    const [s] = ok(parseSheets(strToU8(csv).buffer as ArrayBuffer, 'csv'))
    expect(s!.rows).toEqual([
      ['name', 'amount', 'note'],
      ['Acme, Inc', '12.5', 'said "hi"'],
      ['Globex', '-3', ''],
    ])
    expect(s!.types).toEqual(['sss', 'sns', 'sn '])
    expect(s!.formulas).toEqual({})
    expect(s!.truncated).toBe(false)
    expect(s!.totalRows).toBe(3)
  })

  it('splits TSV on tabs only', () => {
    const tsv = 'a,b\tc\n1\t2\n'
    const [s] = ok(parseSheets(strToU8(tsv).buffer as ArrayBuffer, 'tsv'))
    expect(s!.rows).toEqual([
      ['a,b', 'c'],
      ['1', '2'],
    ])
  })

  it(`reads the first ${MAX_SHEET_ROWS} rows of a long file`, () => {
    const lines = Array.from({ length: MAX_SHEET_ROWS + 10 }, (_, i) => `${i},x`)
    const [s] = ok(parseSheets(strToU8(lines.join('\n')).buffer as ArrayBuffer, 'csv'))
    expect(s!.rows).toHaveLength(MAX_SHEET_ROWS)
    expect(s!.truncated).toBe(true)
  })

  it('reads legacy single-byte text when it is not valid UTF-8', () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x31]) // "café\n1" in Windows-1252
    const [s] = ok(parseSheets(bytes.buffer, 'csv'))
    expect(s!.rows[0]).toEqual(['café'])
  })

  it('drops a UTF-8 byte order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('id,name\n1,x')])
    const [s] = ok(parseSheets(bytes.buffer, 'csv'))
    expect(s!.rows[0]).toEqual(['id', 'name'])
  })
})

describe('handleSheetRequest', () => {
  it('answers a worker request with the parsed sheets', () => {
    const bytes = strToU8('a,b\n1,2').buffer as ArrayBuffer
    const result = handleSheetRequest({ bytes, source: 'csv' })
    expect(result).toMatchObject({
      ok: true,
      sheets: [
        {
          rows: [
            ['a', 'b'],
            ['1', '2'],
          ],
        },
      ],
    })
  })

  it('answers garbage with a failure instead of throwing', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]).buffer
    expect(handleSheetRequest({ bytes, source: 'workbook' })).toEqual({
      ok: false,
      failure: 'corrupt',
    })
  })
})

describe('sheetSourceFor', () => {
  it('routes delimited text to the text parser and everything else to the workbook parser', () => {
    expect(sheetSourceFor('export.csv')).toBe('csv')
    expect(sheetSourceFor('EXPORT.TSV')).toBe('tsv')
    expect(sheetSourceFor('book.xlsx')).toBe('workbook')
    expect(sheetSourceFor('book.xls')).toBe('workbook')
    expect(sheetSourceFor('book.ods')).toBe('workbook')
    expect(sheetSourceFor('book.xlsm')).toBe('workbook')
    expect(sheetSourceFor('export', 'text/csv')).toBe('csv')
  })
})
