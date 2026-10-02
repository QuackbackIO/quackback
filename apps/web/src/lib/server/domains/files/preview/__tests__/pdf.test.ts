// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as mupdf from 'mupdf'
import { derivePdfPreview } from '../pdf'
import { cappedRenderScale } from '../mupdf'

/** A real PDF from mupdf's own writer: one line of text per page. */
function buildPdf(
  pages: Array<{ text: string; size?: [number, number] }>,
  options = ''
): Uint8Array {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'))
  const resources = doc.addObject({ Font: { F1: font } })
  for (const page of pages) {
    const [w, h] = page.size ?? [612, 792]
    const contents = `BT /F1 18 Tf 20 ${h - 40} Td (${page.text}) Tj ET`
    doc.insertPage(-1, doc.addPage([0, 0, w, h], 0, resources, contents))
  }
  return doc.saveToBuffer(options).asUint8Array().slice()
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const image = new mupdf.Image(png)
  return { width: image.getWidth(), height: image.getHeight() }
}

describe('derivePdfPreview', () => {
  it('counts pages, renders page one and reads its text', async () => {
    const bytes = buildPdf([{ text: 'Invoice 2041' }, { text: 'Terms' }, { text: 'Signature' }])
    const result = await derivePdfPreview(bytes)

    expect(result.status).toBe('ready')
    expect(result.meta).toEqual({ pages: 3 })
    expect(result.excerpt).toContain('Invoice 2041')
    expect(result.excerpt).toContain('Signature')

    expect(result.derived).toHaveLength(1)
    const [thumb] = result.derived!
    expect(thumb).toMatchObject({
      field: 'thumbKey',
      suffix: 'thumb.png',
      contentType: 'image/png',
    })
    expect(Array.from(thumb!.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    const size = pngSize(thumb!.bytes)
    expect(size.width).toBe(480)
    expect(Math.abs(size.height - (792 * 480) / 612)).toBeLessThan(1)
  })

  it('keeps a tall page inside the size cap', async () => {
    const result = await derivePdfPreview(buildPdf([{ text: 'Receipt', size: [100, 4000] }]))
    const size = pngSize(result.derived![0]!.bytes)
    expect(size.height).toBeLessThanOrEqual(1200)
    expect(size.width).toBeLessThanOrEqual(480)
  })

  it('reads text from the first ten pages only', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ text: `Section ${i + 1} body` }))
    const result = await derivePdfPreview(buildPdf(pages))
    expect(result.meta.pages).toBe(12)
    expect(result.excerpt).toContain('Section 10 body')
    expect(result.excerpt).not.toContain('Section 11 body')
  })

  it('refuses an encrypted document', async () => {
    const bytes = buildPdf(
      [{ text: 'Secret' }],
      'encrypt=aes-256,user-password=open-sesame,owner-password=owner'
    )
    await expect(derivePdfPreview(bytes)).rejects.toThrow()
  })

  it('refuses bytes that only claim to be a PDF', async () => {
    await expect(
      derivePdfPreview(new TextEncoder().encode('%PDF-1.7\nnot really'))
    ).rejects.toThrow()
  })
})

describe('cappedRenderScale', () => {
  it('keeps every render inside 2400 pixels a side, whatever the page claims', () => {
    expect(cappedRenderScale(14_400, 14_400, 1)).toBeCloseTo(2400 / 14_400)
    expect(cappedRenderScale(100, 30_000, 0.5)).toBeCloseTo(2400 / 30_000)
    expect(14_400 * cappedRenderScale(14_400, 200, 3)).toBeLessThanOrEqual(2400)
  })

  it('leaves a scale that already fits alone', () => {
    expect(cappedRenderScale(612, 792, 480 / 612)).toBe(480 / 612)
  })
})
