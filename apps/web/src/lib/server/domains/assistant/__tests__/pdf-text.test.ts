import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { extractPdfText } from '../pdf-text'

/**
 * Build the smallest PDF that carries real content: one FlateDecode-compressed
 * content stream with the given text-showing operators inside a BT…ET block.
 * The extractor scans for streams rather than parsing xref tables, so a
 * skeletal file like this exercises the same code path as a full document.
 */
function buildPdf(contentStreamOps: string, compress = true): Uint8Array {
  const stream = compress
    ? deflateSync(Buffer.from(contentStreamOps, 'latin1'))
    : Buffer.from(contentStreamOps, 'latin1')
  const filter = compress ? ' /Filter /FlateDecode' : ''
  const pdf = [
    '%PDF-1.4',
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj`,
    `4 0 obj\n<< /Length ${stream.length}${filter} >>\nstream\n${stream.toString('latin1')}\nendstream\nendobj`,
    'trailer\n<< /Root 1 0 R >>\n%%EOF',
  ].join('\n')
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

describe('extractPdfText', () => {
  it('extracts text from a FlateDecode content stream', () => {
    const ops = 'BT /F1 12 Tf 72 720 Td (Refunds are available within 30 days.) Tj ET'
    const text = extractPdfText(buildPdf(ops))
    expect(text).toContain('Refunds are available within 30 days.')
  })

  it('joins TJ array segments and starts a new line at Td', () => {
    const ops =
      'BT /F1 12 Tf 72 720 Td ' + '[(Quarterly) -20 (Report)] TJ ' + '0 -14 Td (Second line.) Tj ET'
    const text = extractPdfText(buildPdf(ops))
    expect(text).toContain('QuarterlyReport')
    expect(text).toContain('\nSecond line.')
  })

  it('decodes literal-string escapes', () => {
    const ops = 'BT /F1 12 Tf 72 720 Td (50\\% off \\(today only\\)) Tj ET'
    const text = extractPdfText(buildPdf(ops))
    expect(text).toContain('50% off (today only)')
  })

  it('extracts from an uncompressed stream too', () => {
    const ops = 'BT /F1 12 Tf 72 720 Td (Plain stream text.) Tj ET'
    const text = extractPdfText(buildPdf(ops, false))
    expect(text).toContain('Plain stream text.')
  })

  it('returns an empty string for a PDF with no text layer (scanned image)', () => {
    // An image-only page: the content stream draws an image, shows no text.
    const ops = 'q 200 0 0 100 0 0 cm /Im1 Do Q'
    expect(extractPdfText(buildPdf(ops))).toBe('')
  })

  it('returns an empty string for input that is not a PDF at all', () => {
    expect(extractPdfText(new Uint8Array(Buffer.from('not a pdf')))).toBe('')
  })
})
