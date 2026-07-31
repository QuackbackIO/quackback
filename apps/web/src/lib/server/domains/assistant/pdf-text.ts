/**
 * Minimal PDF text extraction for knowledge-document ingest.
 *
 * Deliberately dependency-free: the app has no PDF library, and ingest only
 * needs the text layer of typical admin-uploaded documents. The extractor
 * walks every stream object, inflates FlateDecode streams (uncompressed
 * streams pass through), and pulls text out of the text-showing operators
 * inside `BT…ET` blocks: `(…)` literal strings in `Tj`/`TJ`/`'`/`"`, with
 * `Td`/`TD`/`T*` treated as line breaks.
 *
 * Known limits, by design: no ToUnicode CMap resolution (non-latin glyphs
 * encoded as custom codes extract as their raw bytes), no xref parsing
 * (streams are found by scanning, which also tolerates slightly malformed
 * files), and no OCR — a scanned/image-only PDF has no text layer and yields
 * nothing, which the ingest service rejects with a clear error rather than
 * storing an empty document.
 */
import { inflateSync } from 'node:zlib'

/** PDF literal-string escapes worth translating; the rest pass through. */
function decodeLiteralString(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[++i]
    if (next === undefined) break
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case '\\':
      case '(':
      case ')':
        out += next
        break
      default:
        // Octal escapes (\NNN) decode to a byte; anything else is the char.
        if (next >= '0' && next <= '7') {
          let octal = next
          while (octal.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') {
            octal += raw[++i]
          }
          out += String.fromCharCode(parseInt(octal, 8) & 0xff)
        } else {
          out += next
        }
    }
  }
  return out
}

/**
 * Extract the string operands of one `BT…ET` text block. Strings inside a
 * `TJ` array join directly; `Td`/`TD`/`T*` positioning operators become new
 * lines so paragraph structure survives the flattening.
 */
function extractTextBlock(block: string): string {
  const parts: string[] = []
  // Literal strings `(…)` with balanced-paren and escape awareness.
  const literal = /\((?:\\.|[^\\()])*\)/g
  // Split the block on positioning operators first so each text segment lands
  // on its own line.
  for (const segment of block.split(/(?:^|\s)(?:Td|TD|T\*)\b/)) {
    const strings: string[] = []
    for (const match of segment.matchAll(literal)) {
      strings.push(decodeLiteralString(match[0].slice(1, -1)))
    }
    if (strings.length > 0) parts.push(strings.join(''))
  }
  return parts.join('\n')
}

/**
 * Extract the text layer of a PDF, one line per text segment. Returns an
 * empty string when the file has no extractable text (scanned images, or a
 * file that is not a PDF at all) — the caller decides what that means.
 */
export function extractPdfText(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString('latin1')
  const lines: string[] = []

  const streamRe = /stream\r?\n/g
  for (const match of source.matchAll(streamRe)) {
    const start = match.index + match[0].length
    const end = source.indexOf('endstream', start)
    if (end === -1) continue
    // The object dictionary sits before the stream keyword on the same object.
    const dictStart = source.lastIndexOf('<<', match.index)
    const dictionary = dictStart === -1 ? '' : source.slice(dictStart, match.index)
    const raw = Buffer.from(source.slice(start, end).replace(/\r?\n$/, ''), 'latin1')

    let content: string
    if (dictionary.includes('FlateDecode')) {
      try {
        content = inflateSync(raw).toString('latin1')
      } catch {
        continue // A stream that does not inflate is not a text stream.
      }
    } else if (dictionary.includes('Filter')) {
      continue // DCTDecode (images) and friends carry no usable text.
    } else {
      content = raw.toString('latin1')
    }

    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const text = extractTextBlock(block[1])
      if (text.trim()) lines.push(text)
    }
  }

  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
