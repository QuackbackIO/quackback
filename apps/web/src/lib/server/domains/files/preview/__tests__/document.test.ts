import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { deriveDocumentPreview } from '../document'
import { ZipBudgetError } from '@/lib/server/content/zip-budget'

function documentXml(...paragraphs: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') +
    '</w:body></w:document>'
  )
}

function buildDocx(files: Record<string, string>): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  })
}

const APP_XML = (pages: number) =>
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>${pages}</Pages><Words>40</Words></Properties>`

describe('deriveDocumentPreview', () => {
  it('reads the page count and the body text', async () => {
    const bytes = buildDocx({
      'docProps/app.xml': APP_XML(4),
      'word/document.xml': documentXml('Quarterly report', 'Revenue   grew &amp; costs fell'),
    })
    const result = await deriveDocumentPreview(bytes)
    expect(result.status).toBe('ready')
    expect(result.meta).toEqual({ pages: 4 })
    expect(result.excerpt).toBe('Quarterly report\nRevenue grew & costs fell')
  })

  it('leaves the page count out when the package does not record it', async () => {
    const result = await deriveDocumentPreview(
      buildDocx({ 'word/document.xml': documentXml('Only text') })
    )
    expect(result.meta).toEqual({})
    expect(result.excerpt).toBe('Only text')
  })

  it('caps the excerpt', async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `Paragraph number ${i} of the body.`)
    const result = await deriveDocumentPreview(
      buildDocx({ 'word/document.xml': documentXml(...long) })
    )
    expect(result.excerpt!.length).toBeLessThanOrEqual(20_000)
    expect(result.excerpt).toContain('Paragraph number 0 of the body.')
  })

  it('refuses a zip bomb from its index, before inflating', async () => {
    const files: Record<string, string> = { 'word/document.xml': documentXml('hello') }
    for (let i = 0; i < 2001; i++) files[`word/media/pad${i}.xml`] = ''
    await expect(deriveDocumentPreview(buildDocx(files))).rejects.toBeInstanceOf(ZipBudgetError)
  })

  it('refuses a package that is not a zip', async () => {
    await expect(deriveDocumentPreview(strToU8('PK but not really'))).rejects.toThrow()
  })
})
