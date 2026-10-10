import { describe, it, expect, vi, afterEach } from 'vitest'
import XLSX from 'xlsx'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { deriveSpreadsheetPreview } from '../spreadsheet'
import { readZipIndex, ZipBudgetError, ZipFormatError } from '@/lib/shared/files/zip-budget'

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('hands the sheet parser only the parts it reads, re-zipped from the verified index', async () => {
    const parts = unzipSync(write('xlsx'))
    parts['xl/media/image1.png'] = new Uint8Array(4096)
    const read = vi.spyOn(XLSX, 'read')

    const result = await deriveSpreadsheetPreview(zipSync(parts), XLSX_TYPE)

    expect(result.meta).toMatchObject({ sheets: ['Data', 'Summary'], rows: 501 })
    expect(read).toHaveBeenCalledTimes(1)
    const given = read.mock.calls[0]![0] as Uint8Array
    const entries = readZipIndex(new Uint8Array(given))
    expect(entries.map((e) => e.name).sort()).toEqual(
      [
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/worksheets/sheet1.xml',
        'xl/styles.xml',
      ].sort()
    )
    // Stored, so the parser inflates nothing.
    expect(entries.every((e) => e.compression === 0)).toBe(true)
  })

  it('refuses a workbook with a second end record after the one the index reads', async () => {
    const zip = write('xlsx')
    const tail = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0])
    const out = new Uint8Array(zip.length + tail.length)
    out.set(zip)
    out.set(tail, zip.length)
    // The end record's comment length covers the tail.
    const eocd = zip.length - 22
    out[eocd + 20] = tail.length
    await expect(deriveSpreadsheetPreview(out, XLSX_TYPE)).rejects.toBeInstanceOf(ZipFormatError)
  })

  it('refuses a workbook whose local header disagrees with the index for a part it reads', async () => {
    const zip = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8('<workbook/>'),
    })
    // The workbook's local header claims another uncompressed size than its index does.
    const lying = zip.slice()
    const workbookEntry = readZipIndex(zip).find((e) => e.name === 'xl/workbook.xml')!
    new DataView(lying.buffer).setUint32(workbookEntry.localHeaderOffset + 22, 999, true)
    await expect(deriveSpreadsheetPreview(lying, XLSX_TYPE)).rejects.toBeInstanceOf(ZipFormatError)
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
