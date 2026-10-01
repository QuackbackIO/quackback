import { describe, it, expect } from 'vitest'
import XLSX from 'xlsx'
import { zipSync } from 'fflate'
import { deriveSpreadsheetPreview } from '../spreadsheet'
import { ZipBudgetError } from '@/lib/shared/files/zip-budget'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function workbook(): XLSX.WorkBook {
  const rows: unknown[][] = [['Name', 'Amount', 'Note', 'D', 'E', 'F', 'G', 'H', 'I', 'J']]
  for (let i = 1; i <= 500; i++) {
    rows.push([`Row ${i}`, i * 1.5, i === 1 ? 'x'.repeat(100) : 'note', 4, 5, 6, 7, 8, 9, 'tenth'])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['other']]), 'Summary')
  return wb
}

function write(bookType: XLSX.BookType): Uint8Array {
  return new Uint8Array(XLSX.write(workbook(), { type: 'buffer', bookType }) as Buffer)
}

describe('deriveSpreadsheetPreview', () => {
  it('reads sheet names, the row count and a 6x8 head from an xlsx', async () => {
    const result = await deriveSpreadsheetPreview(write('xlsx'), XLSX_TYPE)
    expect(result.status).toBe('ready')
    expect(result.meta.sheets).toEqual(['Data', 'Summary'])
    expect(result.meta.rows).toBe(501)

    const head = result.meta.head!
    expect(head).toHaveLength(6)
    expect(head.every((row) => row.length === 8)).toBe(true)
    expect(head[0]).toEqual(['Name', 'Amount', 'Note', 'D', 'E', 'F', 'G', 'H'])
    expect(head[1]![0]).toBe('Row 1')
    expect(head[1]![1]).toBe('1.5')
    expect(head[1]![2]!.length).toBeLessThanOrEqual(40)
  })

  it('writes the first rows of the first sheet as the excerpt', async () => {
    const result = await deriveSpreadsheetPreview(write('xlsx'), XLSX_TYPE)
    expect(result.excerpt).toContain('Row 1,1.5')
    expect(result.excerpt).toContain('Row 199,')
    expect(result.excerpt).not.toContain('Row 300,')
    expect(result.excerpt).toContain('tenth')
    expect(result.excerpt).not.toContain('other')
  })

  it('drops bidirectional and invisible characters from sheet names', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'Q3‮xslx')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['b']]), 'To​do⁦')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    const result = await deriveSpreadsheetPreview(bytes, XLSX_TYPE)
    expect(result.meta.sheets).toEqual(['Q3xslx', 'Todo'])
  })

  it('reads legacy .xls and OpenDocument sheets too', async () => {
    const xls = await deriveSpreadsheetPreview(write('xls'), 'application/vnd.ms-excel')
    expect(xls.meta).toMatchObject({ sheets: ['Data', 'Summary'], rows: 501 })
    const ods = await deriveSpreadsheetPreview(
      write('ods'),
      'application/vnd.oasis.opendocument.spreadsheet'
    )
    expect(ods.meta).toMatchObject({ sheets: ['Data', 'Summary'], rows: 501 })
    expect(ods.meta.head![1]![0]).toBe('Row 1')
  })

  it('refuses a zip bomb before the sheet parser sees it', async () => {
    const bomb = zipSync({
      '[Content_Types].xml': new TextEncoder().encode('<Types/>'),
      'xl/workbook.xml': new TextEncoder().encode('<workbook/>'),
      'xl/worksheets/sheet1.xml': new Uint8Array(16 * 1024 * 1024),
    })
    await expect(deriveSpreadsheetPreview(bomb, XLSX_TYPE)).rejects.toBeInstanceOf(ZipBudgetError)
  })
})
