/**
 * PDF: page count, page one as a PNG thumbnail, and the text of the first
 * pages. An encrypted or unreadable document throws.
 */
import { loadMupdf, destroy, cappedRenderScale } from './mupdf'
import { NO_DEADLINE, normalizeExcerpt, EXCERPT_MAX_CHARS, type PreviewResult } from './result'
import type { Deadline } from './result'

/** Thumbnail width; neither side may exceed the cap. */
const THUMB_WIDTH = 480
const THUMB_MAX_SIDE = 1200
/** Pages whose text is read for the excerpt. */
const TEXT_PAGES = 10

export async function derivePdfPreview(
  bytes: Uint8Array,
  deadline: Pick<Deadline, 'check'> = NO_DEADLINE
): Promise<PreviewResult> {
  const mupdf = await loadMupdf()
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  try {
    if (doc.needsPassword()) throw new Error('Encrypted PDF')
    const pages = doc.countPages()
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error('PDF has no pages')
    deadline.check()

    const first = doc.loadPage(0)
    let thumb: Uint8Array
    try {
      const [x0, y0, x1, y1] = first.getBounds()
      const width = x1 - x0
      const height = y1 - y0
      if (!(width > 0 && height > 0)) throw new Error('PDF page has no area')
      const scale = cappedRenderScale(
        width,
        height,
        Math.min(THUMB_WIDTH / width, THUMB_MAX_SIDE / height)
      )
      const pixmap = first.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true
      )
      thumb = pixmap.asPNG().slice()
      destroy(pixmap)
    } finally {
      destroy(first)
    }

    const parts: string[] = []
    let length = 0
    for (let i = 0; i < Math.min(pages, TEXT_PAGES) && length < EXCERPT_MAX_CHARS; i++) {
      deadline.check()
      const page = doc.loadPage(i)
      try {
        const text = page.toStructuredText('preserve-whitespace')
        const s = text.asText()
        destroy(text)
        parts.push(s)
        length += s.length
      } finally {
        destroy(page)
      }
    }

    return {
      status: 'ready',
      meta: { pages },
      excerpt: normalizeExcerpt(parts.join('\n\n')),
      derived: [{ suffix: 'thumb.png', contentType: 'image/png', bytes: thumb, field: 'thumbKey' }],
    }
  } finally {
    destroy(doc)
  }
}
