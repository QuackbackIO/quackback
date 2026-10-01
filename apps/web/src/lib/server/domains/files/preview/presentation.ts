/**
 * PowerPoint (.pptx, .pptm): the slide count and the text of the first
 * slides, in slide order. No thumbnail: nothing here can render a slide.
 */
import { openZip } from '@/lib/shared/files/zip-budget'
import { decodeXmlEntities, elementContents } from '@/lib/server/content/docx-text'
import { appPropertyCount } from './document'
import { normalizeExcerpt, EXCERPT_MAX_CHARS, type PreviewResult } from './result'

const KB = 1024
const SLIDE_XML_BYTES = 2 * 1024 * KB
const APP_XML_BYTES = 256 * KB
/** Slides read for the excerpt, at most. */
const TEXT_SLIDES = 30

const decoder = new TextDecoder()

/** The text of one slide part: `<a:t>` runs, one line per `<a:p>` paragraph. */
function slideText(xml: string): string {
  const lines: string[] = []
  for (const paragraph of elementContents(xml, 'a:p')) {
    let line = ''
    for (const run of elementContents(paragraph, 'a:t')) line += decodeXmlEntities(run)
    if (line.trim()) lines.push(line)
  }
  return lines.join('\n')
}

export async function derivePresentationPreview(bytes: Uint8Array): Promise<PreviewResult> {
  const zip = openZip(bytes)
  const slides = zip.entries
    .map((e) => ({ name: e.name, n: /^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name)?.[1] }))
    .filter((s): s is { name: string; n: string } => s.n !== undefined)
    .sort((a, b) => Number(a.n) - Number(b.n))

  const pages =
    appPropertyCount(
      zip.read('docProps/app.xml', { maxBytes: APP_XML_BYTES, truncate: true }),
      'Slides'
    ) ??
    (slides.length || undefined)

  const parts: string[] = []
  let length = 0
  for (const slide of slides.slice(0, TEXT_SLIDES)) {
    if (length >= EXCERPT_MAX_CHARS) break
    const xml = zip.read(slide.name, { maxBytes: SLIDE_XML_BYTES, truncate: true })
    const text = xml ? slideText(decoder.decode(xml)) : ''
    if (!text) continue
    parts.push(text)
    length += text.length
  }

  return {
    status: 'ready',
    meta: pages ? { pages } : {},
    excerpt: normalizeExcerpt(parts.join('\n\n')),
  }
}
