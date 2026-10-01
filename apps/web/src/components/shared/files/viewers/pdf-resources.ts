/**
 * How the PDF engine opens a document: the `getDocument` parameters, and the
 * files pdf.js may ask for while drawing one (character maps for CJK text,
 * the Symbol and Dingbats fonts, the JPEG 2000 and JBIG2 image decoders).
 *
 * Those files ship with our own build and are served from this origin. pdf.js
 * asks for them by name through `SelfHostedBinaryData`, which answers only
 * for names in the shipped set: the worker never fetches by URL
 * (`useWorkerFetch: false`), so a document cannot make it fetch anything
 * else. Each file is fetched only when an open document needs it.
 */
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'

type ResourceKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

function byFileName(urls: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, url] of Object.entries(urls)) out[path.slice(path.lastIndexOf('/') + 1)] = url
  return out
}

let files: Record<ResourceKind, Record<string, string>> | null = null

/** Self-hosted URL of every file pdf.js may request, by kind and file name. */
export function selfHostedPdfFiles(): Record<ResourceKind, Record<string, string>> {
  files ??= {
    cMapUrl: byFileName(
      import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
        query: '?url&no-inline',
        import: 'default',
        eager: true,
        exhaustive: true,
      })
    ),
    standardFontDataUrl: byFileName(
      import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
        query: '?url&no-inline',
        import: 'default',
        eager: true,
        exhaustive: true,
      })
    ),
    wasmUrl: byFileName(
      import.meta.glob<string>('/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm', {
        query: '?url&no-inline',
        import: 'default',
        eager: true,
        exhaustive: true,
      })
    ),
  }
  return files
}

/**
 * pdf.js's main-thread loader for character maps, fonts and decoders
 * (the `BinaryDataFactory` parameter). Unknown names are refused unfetched.
 */
export class SelfHostedBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const shipped = selfHostedPdfFiles()
    const table = Object.hasOwn(shipped, kind) ? shipped[kind as ResourceKind] : undefined
    const url = table && Object.hasOwn(table, filename) ? table[filename] : undefined
    if (!url) throw new Error(`Not a shipped PDF resource: ${kind}/${filename}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load PDF resource ${filename}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** Decoded images above this many pixels are skipped rather than allocated. */
const MAX_IMAGE_PIXELS = 2 ** 26

/**
 * `getDocument` parameters for bytes already in hand. No URL, no base URL and
 * no password: nothing is fetched for the document itself, relative links in
 * it resolve to nothing, and an encrypted file fails to open.
 */
export function pdfDocumentParams(data: Uint8Array) {
  return {
    data,
    enableXfa: false,
    useWorkerFetch: false,
    BinaryDataFactory: SelfHostedBinaryData,
    disableFontFace: false,
    maxImageSize: MAX_IMAGE_PIXELS,
  } satisfies DocumentInitParameters
}
