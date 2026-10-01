/**
 * Word (.docx, .docm): the page count Word recorded when it last saved, and
 * the body text. Only two parts are inflated, each with a cap, after the
 * archive's index passes the zip budget.
 */
import { openZip } from '@/lib/server/content/zip-budget'
import { docxDocumentText } from '@/lib/server/content/docx-text'
import { normalizeExcerpt, type PreviewResult } from './result'

const KB = 1024
const MB = 1024 * KB

/** Plenty for the excerpt's 20,000 characters even in verbose XML. */
const DOCUMENT_XML_BYTES = 8 * MB
const APP_XML_BYTES = 256 * KB

const decoder = new TextDecoder()

/** A count recorded in `docProps/app.xml` (`Pages`, `Slides`), when it is sane. */
export function appPropertyCount(appXml: Uint8Array | null, tag: string): number | undefined {
  if (!appXml) return undefined
  const match = new RegExp(`<${tag}>\\s*(\\d{1,7})\\s*</${tag}>`).exec(decoder.decode(appXml))
  const n = match ? Number(match[1]) : NaN
  return n > 0 ? n : undefined
}

export async function deriveDocumentPreview(bytes: Uint8Array): Promise<PreviewResult> {
  const zip = openZip(bytes)
  const pages = appPropertyCount(
    zip.read('docProps/app.xml', { maxBytes: APP_XML_BYTES, truncate: true }),
    'Pages'
  )
  const documentXml = zip.read('word/document.xml', {
    maxBytes: DOCUMENT_XML_BYTES,
    truncate: true,
  })
  if (!documentXml) throw new Error('Not a Word document')
  return {
    status: 'ready',
    meta: pages ? { pages } : {},
    excerpt: normalizeExcerpt(docxDocumentText(decoder.decode(documentXml))),
  }
}
