/**
 * Word documents to a sandboxed frame. docx-preview builds the file's DOM in
 * an inert document (one with no browsing context, so nothing in it loads or
 * runs) that is never attached to the app; the result is serialized,
 * sanitized, and shown in an `<iframe sandbox>` (no scripts, an opaque
 * origin) whose own content security policy forbids every load except inline
 * styles and `data:` images and fonts. Its only permission is opening web and
 * mail links in a new tab. File-derived HTML never reaches the app's DOM.
 */
// The library's standalone build, not its module entry: rich text imports
// that one on nearly every page, and sharing it would split it into a chunk
// of its own that each of those pages fetches. This copy stays in the lazy
// Word viewer.
import DOMPurify from 'dompurify/purify.min.js'
import { parseAsync, renderDocument, type HElement, type Options } from 'docx-preview'

export const DOCUMENT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

/**
 * The frame's sandbox: popups, and popups free of the sandbox, so a link opens
 * as an ordinary new tab. Never scripts, never the app's origin, never
 * navigating the app.
 */
export const DOCUMENT_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox'

/**
 * docx-preview settings. Its defaults render embedded HTML ("alt chunks") into
 * an unsandboxed frame and images as blob: URLs; both are turned off here.
 */
export const DOCUMENT_RENDER_OPTIONS: Partial<Options> = {
  renderAltChunks: false,
  useBase64URL: true,
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  experimental: false,
  ignoreFonts: true,
  renderComments: false,
  renderChanges: false,
  debug: false,
}

/** US Letter, when a document does not say how wide its pages are. */
const DEFAULT_PAGE_WIDTH_PX = 816

export interface RenderedDocument {
  /** Sanitized markup for the frame's body. */
  html: string
  /** The widest page, in CSS pixels at 100%. */
  pageWidthPx: number
  /** No page holds any text, picture or table: only blank paper. */
  empty: boolean
}

/** Whether rendered pages carry anything a reader would see besides blank paper. */
function hasContent(pages: readonly Element[]): boolean {
  return pages.some(
    (page) =>
      (page.textContent ?? '').trim() !== '' || page.querySelector('img, svg, table') !== null
  )
}

/**
 * docx-preview's element factory, building into `doc` instead of the page.
 * Its own factory uses the live document, where a detached `<img>` still
 * fetches its `src`.
 */
export function inertElementFactory(doc: Document): (elem: HElement | Node | string) => Node {
  const h = (elem: HElement | Node | string): Node => {
    if (typeof elem === 'string') return doc.createTextNode(elem)
    if (elem instanceof Node) return elem
    const { ns, tagName, className, style, children, ...props } = elem
    if (tagName === '#fragment') {
      const fragment = doc.createDocumentFragment()
      for (const child of children ?? []) fragment.appendChild(h(child))
      return fragment
    }
    if (tagName === '#comment') return doc.createComment(children ? String(children[0]) : '')
    const el = ns ? doc.createElementNS(ns, tagName) : doc.createElement(tagName)
    if (className) el.setAttribute('class', className)
    if (typeof style === 'string') el.setAttribute('style', style)
    else if (style) Object.assign((el as HTMLElement).style, style)
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) (el as unknown as Record<string, unknown>)[key] = value
    }
    for (const child of children ?? []) el.appendChild(h(child))
    return el
  }
  return h
}

export async function renderDocumentHtml(
  bytes: ArrayBuffer | Uint8Array
): Promise<RenderedDocument> {
  const inert = document.implementation.createHTMLDocument('')
  const options = { ...DOCUMENT_RENDER_OPTIONS, h: inertElementFactory(inert) }
  const parsed = await parseAsync(bytes, options)
  const nodes = await renderDocument(parsed, options)
  const container = inert.createElement('div')
  for (const node of nodes) container.appendChild(node)

  const pages = Array.from(container.querySelectorAll<HTMLElement>('section.docx'))
  let widest = 0
  for (const section of pages) {
    widest = Math.max(widest, pageWidthPx(section.style.width) ?? 0)
  }
  return {
    html: sanitizeDocumentHtml(container.innerHTML),
    pageWidthPx: widest || DEFAULT_PAGE_WIDTH_PX,
    empty: !hasContent(pages),
  }
}

const UNITS_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
}

/** A CSS length in absolute units as pixels, or null. */
export function pageWidthPx(width: string): number | null {
  const match = /^\s*([\d.]+)(px|pt|in|cm|mm)\s*$/.exec(width)
  if (!match) return null
  const value = Number.parseFloat(match[1]!)
  return Number.isFinite(value) ? Math.round(value * UNITS_PX[match[2]!]! * 10) / 10 : null
}

const FORBID_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'link',
  'meta',
  'base',
  'template',
  'slot',
  'portal',
  'audio',
  'video',
  'source',
  'track',
]

const FORBID_ATTR = ['action', 'formaction', 'srcset', 'ping', 'background', 'poster']

const LINK_SCHEME = /^(?:https?|mailto):/i

type Purifier = Pick<ReturnType<typeof DOMPurify>, 'isSupported' | 'sanitize'>

const CANARY = '<p title="ok">x</p><img src="x" onerror="1"><script>1</script>'

/**
 * DOMPurify hands its input back untouched when it cannot run in the current
 * environment. Refuse to render instead of trusting that silently.
 */
export function sanitizerWorks(instance: Purifier): boolean {
  if (!instance.isSupported) return false
  const out = instance.sanitize(CANARY)
  return out.includes('<p title="ok">x</p>') && !/script|onerror/i.test(out)
}

let purifier: ReturnType<typeof DOMPurify> | null = null

/** A DOMPurify instance of our own, so its hooks never touch other callers. */
function documentPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier
  const instance = DOMPurify(window)
  if (!sanitizerWorks(instance)) throw new Error('The HTML sanitizer is unavailable')
  instance.addHook('afterSanitizeAttributes', (node) => {
    const tag = node.nodeName.toLowerCase()
    if (tag === 'a' || tag === 'area') {
      const href = node.getAttribute('href')?.trim() ?? ''
      node.removeAttribute('xlink:href')
      if (href && LINK_SCHEME.test(href)) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      } else {
        node.removeAttribute('href')
        node.removeAttribute('target')
      }
      return
    }
    if (tag === 'img' || tag === 'image') {
      let embedded = false
      for (const name of ['src', 'href', 'xlink:href']) {
        const value = node.getAttribute(name)
        if (value === null) continue
        if (value.trim().toLowerCase().startsWith('data:image/')) embedded = true
        else node.removeAttribute(name)
      }
      // An image the file only links to shows nothing, not a broken frame.
      if (!embedded) node.setAttribute('hidden', '')
    }
  })
  purifier = instance
  return instance
}

/**
 * Sanitizes rendered document markup. Styles stay (they are the layout);
 * scripts, handlers, frames, plugins and forms go; links keep only web and
 * mail addresses and open outside the frame; images keep only embedded data.
 */
export function sanitizeDocumentHtml(html: string): string {
  return withUnicodeBullets(
    documentPurifier().sanitize(html, {
      FORCE_BODY: true,
      FORBID_TAGS,
      FORBID_ATTR,
    })
  )
}

/**
 * Word writes list bullets as private-use characters of the Symbol and
 * Wingdings fonts, which most systems outside Windows do not have, so the
 * bullet renders as nothing. Each common one maps to the Unicode glyph it
 * draws. The replacement is character for character and cannot form markup.
 */
const LEGACY_FONT_BULLETS: Record<string, string> = {
  '\uf0b7': '\u2022', // Symbol bullet
  '\uf0a7': '\u25aa', // Wingdings small square
  '\uf0d8': '\u27a2', // Wingdings arrowhead
  '\uf076': '\u2756', // Wingdings diamond of diamonds
  '\uf0fc': '\u2713', // Wingdings check mark
  '\uf06c': '\u25cf', // Wingdings filled circle
  '\uf06e': '\u25a0', // Wingdings filled square
  '\uf071': '\u2751', // Wingdings shadowed square
}

function withUnicodeBullets(html: string): string {
  return html.replace(/[\uf000-\uf0ff]/g, (c) => LEGACY_FONT_BULLETS[c] ?? c)
}

/** The desk behind the pages, matching the app's light and dark themes. */
const DESK = { light: 'oklch(0.935 0 0)', dark: 'oklch(0.11 0 0)' }

/**
 * The frame's whole document: the policy first, then base styles that set
 * white pages on the desk, then the sanitized body.
 */
export function buildDocumentSrcdoc(
  bodyHtml: string,
  { zoom, dark }: { zoom: number; dark: boolean }
): string {
  const desk = dark ? DESK.dark : DESK.light
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '<style>',
    `html,body{margin:0;padding:0;background:${desk};color-scheme:light}`,
    `.docx-wrapper{background:${desk} !important;padding:24px 16px !important;gap:20px;zoom:${zoom}}`,
    '.docx-wrapper>section.docx{background:#fff !important;margin:0 !important;box-shadow:0 2px 14px rgb(0 0 0 / .14) !important;flex-shrink:0}',
    'a[href]{cursor:pointer}',
    '</style></head><body>',
    bodyHtml,
    '</body></html>',
  ].join('')
}
