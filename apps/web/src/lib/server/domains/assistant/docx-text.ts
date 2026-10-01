/**
 * Minimal Word (.docx) text extraction for knowledge-document ingest.
 *
 * Deliberately dependency-free in the same sense as `./pdf-text`: a .docx is
 * a zip of XML, so the zip reader in `content/zip-budget` checks the archive
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
import { openZip } from '@/lib/server/content/zip-budget'

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

/**
 * Extract the text of one paragraph's runs: every `<w:t>` element's content,
 * with `<w:tab/>` and `<w:br/>` between runs kept as their characters.
 */
function extractParagraphText(paragraphXml: string): string {
  const parts: string[] = []
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g
  for (const match of paragraphXml.matchAll(tokenRe)) {
    if (match[1] !== undefined) parts.push(decodeXmlEntities(match[1]))
    else parts.push(match[0].startsWith('<w:tab') ? '\t' : '\n')
  }
  return parts.join('')
}

/** The text of a `word/document.xml` part, one line per paragraph. */
export function docxDocumentText(documentXml: string): string {
  const lines: string[] = []
  for (const match of documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = extractParagraphText(match[1])
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
