/**
 * A real, minimal .docx built in memory, carrying the hostile parts a Word
 * file can hold: a javascript: hyperlink, an external (tracking) image, and
 * an embedded HTML alt chunk with a script.
 */
import { strToU8, zipSync, type Zippable } from 'fflate'

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ')

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// 1x1 transparent PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
)

function picture(relId: string): string {
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

export function docxFixture(opts: { extraEntries?: number } = {}): Uint8Array {
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="html" ContentType="text/html"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId2" Type="${REL}/hyperlink" Target="javascript:alert(document.cookie)" TargetMode="External"/>` +
        `<Relationship Id="rId3" Type="${REL}/hyperlink" Target="https://example.com/docs" TargetMode="External"/>` +
        `<Relationship Id="rId4" Type="${REL}/image" Target="http://tracker.example/pixel.png" TargetMode="External"/>` +
        `<Relationship Id="rId5" Type="${REL}/image" Target="media/dot.png"/>` +
        `<Relationship Id="rId6" Type="${REL}/aFChunk" Target="chunk.html"/>` +
        `</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>` +
        `<w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p>` +
        `<w:p><w:hyperlink r:id="rId2"><w:r><w:t>Click me</w:t></w:r></w:hyperlink></w:p>` +
        `<w:p><w:hyperlink r:id="rId3"><w:r><w:t>Read the docs</w:t></w:r></w:hyperlink></w:p>` +
        picture('rId5') +
        picture('rId4') +
        `<w:altChunk r:id="rId6"/>` +
        `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
        `</w:body></w:document>`
    ),
    'word/media/dot.png': PNG,
    'word/chunk.html': strToU8(
      '<html><body><p>alt chunk</p><script>parent.alert(1)</script></body></html>'
    ),
  }
  for (let i = 0; i < (opts.extraEntries ?? 0); i++) files[`word/extra/${i}.xml`] = strToU8('<x/>')
  return zipSync(files, { level: 1 })
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
