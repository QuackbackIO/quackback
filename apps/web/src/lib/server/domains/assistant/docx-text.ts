/**
 * Minimal Word (.docx) text extraction for knowledge-document ingest.
 *
 * Deliberately dependency-free in the same sense as `./pdf-text`: a .docx is
 * a zip of XML, and the repo already carries fflate (workspace data export),
 * so `unzipSync` reads `word/document.xml` and a small scanner pulls the
 * text layer out of it — `<w:t>` run contents joined within a paragraph,
 * `</w:p>` treated as a line break, `<w:tab/>`/`<w:br/>` as their characters,
 * with XML entities decoded.
 *
 * Known limits, by design: only the main document part is read (no headers,
 * footers, footnotes, or text boxes), table cells flatten to paragraphs, and
 * embedded images yield nothing — a document whose text is all images
 * extracts as empty, which the ingest service rejects with a clear error
 * rather than storing an empty document.
 */
import { unzipSync, strFromU8 } from 'fflate'

/** XML entity decoding for text-run contents (named plus numeric). */
function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
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

/**
 * Extract the text layer of a .docx, one line per paragraph. Returns an
 * empty string when the bytes are not a zip, the archive has no
 * `word/document.xml`, or the document has no text runs — the caller decides
 * what that means.
 */
export function extractDocxText(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    return '' // Not a zip, so not a .docx.
  }
  const documentXml = files['word/document.xml']
  if (!documentXml) return ''

  const source = strFromU8(documentXml)
  const lines: string[] = []
  for (const match of source.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = extractParagraphText(match[1])
    if (text.trim()) lines.push(text)
  }

  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
