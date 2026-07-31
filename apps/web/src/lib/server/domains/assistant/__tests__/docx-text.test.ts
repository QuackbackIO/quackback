import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractDocxText } from '../docx-text'

/**
 * Build the smallest .docx that carries real content: a zip whose
 * `word/document.xml` holds the given body XML inside the standard document
 * wrapper. fflate is already the repo's zip facility (workspace export), so
 * tests synthesize the archive the same way a Word export would.
 */
function buildDocx(bodyXml: string): Uint8Array {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body></w:document>`
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
    ),
    'word/document.xml': strToU8(documentXml),
  })
}

function paragraph(...runs: string[]): string {
  return `<w:p>${runs.map((r) => `<w:r><w:t>${r}</w:t></w:r>`).join('')}</w:p>`
}

describe('extractDocxText', () => {
  it('extracts paragraph text from word/document.xml', () => {
    const bytes = buildDocx(paragraph('Refunds are available within 30 days of purchase.'))
    const text = extractDocxText(bytes)
    expect(text).toContain('Refunds are available within 30 days of purchase.')
  })

  it('joins runs within a paragraph and breaks between paragraphs', () => {
    const bytes = buildDocx(paragraph('Quarterly', ' Report') + paragraph('Second line.'))
    const text = extractDocxText(bytes)
    expect(text).toContain('Quarterly Report')
    expect(text).toContain('\nSecond line.')
  })

  it('decodes XML entities inside text runs', () => {
    const bytes = buildDocx(paragraph('Fish &amp; Chips &lt;tasty&gt;'))
    expect(extractDocxText(bytes)).toContain('Fish & Chips <tasty>')
  })

  it('renders w:tab as a tab and w:br as a line break', () => {
    const bytes = buildDocx(
      '<w:p><w:r><w:t>Plan</w:t><w:tab/><w:t>Price</w:t><w:br/><w:t>Pro $10</w:t></w:r></w:p>'
    )
    const text = extractDocxText(bytes)
    expect(text).toContain('Plan\tPrice')
    expect(text).toContain('\nPro $10')
  })

  it('returns an empty string for a document with no text runs', () => {
    const bytes = buildDocx('<w:p><w:r><w:drawing/></w:r></w:p>')
    expect(extractDocxText(bytes)).toBe('')
  })

  it('returns an empty string for a zip without word/document.xml', () => {
    const bytes = zipSync({ 'word/styles.xml': strToU8('<w:styles/>') })
    expect(extractDocxText(bytes)).toBe('')
  })

  it('returns an empty string for input that is not a zip at all', () => {
    expect(extractDocxText(strToU8('not a docx file'))).toBe('')
  })
})
