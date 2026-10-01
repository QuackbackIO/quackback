/**
 * Minimal Word (.docx) text extraction for knowledge-document ingest.
 *
 * Deliberately dependency-free in the same sense as `./pdf-text`: a .docx is
 * a zip of XML, so the zip reader in `lib/shared/files/zip-budget` checks the archive
 * against its budget, inflates only `word/document.xml`, and a small scanner
 * pulls the text layer out of it — `<w:t>` run contents joined within a
 * paragraph, `</w:p>` treated as a line break, `<w:tab/>`/`<w:br/>` as their
 * characters, with XML entities decoded.
 *
 * Known limits, by design: only the main document part is read (no headers,
 * footers, footnotes, or text boxes), table cells flatten to paragraphs, and
 * embedded images yield nothing — a document whose text is all images
 * extracts as empty, which the ingest service rejects with a clear error
 * rather than storing an empty document.
 */
import { openZip } from '@/lib/shared/files/zip-budget'

/** A numeric character reference, or nothing when it names no character text can hold. */
function codePoint(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ''
  return String.fromCodePoint(n)
}

/** XML entity decoding for text-run contents (named plus numeric). */
export function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The tag name that starts at `from`, ending at whitespace, `/` or `to` (the `>`). */
function tagName(xml: string, from: number, to: number): string {
  let i = from
  for (; i < to; i++) {
    const c = xml.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2f) break
  }
  return xml.slice(from, i)
}

/**
 * The content of each `name` element, in document order. Every search moves
 * forward from where the last one ended, so markup with thousands of
 * unclosed tags costs one pass rather than one pass per tag. Elements of one
 * name do not nest in the parts read here; a missing end tag ends the scan.
 */
export function* elementContents(xml: string, name: string): Generator<string> {
  const close = `</${name}>`
  let p = 0
  for (;;) {
    const lt = xml.indexOf(`<${name}`, p)
    if (lt < 0) return
    const gt = xml.indexOf('>', lt)
    if (gt < 0) return
    p = gt + 1
    // A longer name with the same prefix (`<w:pPr>`), or an empty element.
    if (tagName(xml, lt + 1, gt) !== name || xml.charCodeAt(gt - 1) === 0x2f) continue
    const end = xml.indexOf(close, gt + 1)
    if (end < 0) return
    yield xml.slice(gt + 1, end)
    p = end + close.length
  }
}

/**
 * Extract the text of one paragraph's runs: every `<w:t>` element's content,
 * with `<w:tab/>` and `<w:br/>` between runs kept as their characters. One
 * forward pass over the paragraph's tags.
 */
function extractParagraphText(paragraphXml: string): string {
  const parts: string[] = []
  for (let p = 0; ;) {
    const lt = paragraphXml.indexOf('<w:', p)
    if (lt < 0) break
    const gt = paragraphXml.indexOf('>', lt)
    if (gt < 0) break
    p = gt + 1
    const name = tagName(paragraphXml, lt + 1, gt)
    const empty = paragraphXml.charCodeAt(gt - 1) === 0x2f
    if (name === 'w:t' && !empty) {
      const end = paragraphXml.indexOf('</w:t>', gt + 1)
      if (end < 0) break
      parts.push(decodeXmlEntities(paragraphXml.slice(gt + 1, end)))
      p = end + 6
    } else if (
      empty &&
      (name === 'w:tab' || name === 'w:br') &&
      !paragraphXml.slice(lt + 1 + name.length, gt - 1).trim()
    ) {
      parts.push(name === 'w:tab' ? '\t' : '\n')
    }
  }
  return parts.join('')
}

/** The text of a `word/document.xml` part, one line per paragraph. */
export function docxDocumentText(documentXml: string): string {
  const lines: string[] = []
  for (const paragraph of elementContents(documentXml, 'w:p')) {
    const text = extractParagraphText(paragraph)
    if (text.trim()) lines.push(text)
  }

  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extract the text layer of a .docx, one line per paragraph. Returns an
 * empty string when the bytes are not a zip, the archive is over the zip
 * budget, it has no `word/document.xml`, or the document has no text runs —
 * the caller decides what that means.
 */
export function extractDocxText(bytes: Uint8Array): string {
  let documentXml: Uint8Array | null
  try {
    documentXml = openZip(bytes).read('word/document.xml')
  } catch {
    return '' // Not a readable zip, or one over budget.
  }
  if (!documentXml) return ''
  return docxDocumentText(new TextDecoder().decode(documentXml))
}
