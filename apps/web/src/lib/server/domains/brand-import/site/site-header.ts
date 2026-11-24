/**
 * The site's header bar, found in its markup without running it: the
 * element that is the header, and the first few containers inside it, since
 * a bar is often painted on an inner wrapper. Read for its fill by
 * site-style.ts, from the stylesheets or the markup's own fill.
 *
 * A <header> or role="banner" wins over a bar named by its class or id: a
 * class such as "topbar" is as often a promotion strip above the header. Only
 * a header before the page's main content counts; one inside it belongs to an
 * article or a card.
 */
import type { PageElement } from './site-style'

/** A header named by its class or id rather than its tag. */
const HEADER_NAME =
  /(^|[-_])(site-?header|page-?header|global-?header|header|masthead|navbar|nav-?bar|top-?nav|global-?nav)([-_]|$)/i
/** The elements inside a header read for its fill, after the header itself. */
const HEADER_INNER = 3
/** Tags that never hold others, so never deepen the header. */
const VOID_TAGS = new Set(
  'area base br col embed hr img input link meta source track wbr'.split(' ')
)
/**
 * The elements inside a header that can paint its bar: containers. A link,
 * button or image there (a skip link, a call to action) paints only itself.
 */
const HEADER_WRAPPERS = new Set('div nav section ul header table tbody tr td'.split(' '))
/** Hidden-until-focused and screen-reader-only elements paint nothing a visitor sees. */
const OFFSCREEN_NAME = /skip|sr-only|visually-?hidden|screen-reader/i
/** How far into the body a header is looked for when the page names no main content. */
const HEADER_SCAN_TAGS = 400

/** Whether a tag opens no element that holds others. */
export const isVoidTag = (name: string, tag: string) => tag.endsWith('/>') || VOID_TAGS.has(name)

/** One tag as the markup scan meets it. */
export interface ScannedTag {
  name: string
  closing: boolean
  void: boolean
  classes: string[]
  id: string
  role: string
  element: () => PageElement
}

/** Follows the markup scan, tag by tag, and keeps the header it meets. */
export function headerFinder() {
  let semantic: PageElement[] | null = null
  let named: PageElement[] | null = null
  let open: { into: PageElement[]; depth: number } | null = null
  let searching = true
  let seen = 0
  return {
    /** Whether the finder still needs tags: looking, or inside a header. */
    get busy() {
      return searching || open !== null
    },
    /** Every tag, closing ones included, before the scan skips any. */
    track(tag: Pick<ScannedTag, 'closing' | 'void'>) {
      if (!open || tag.void) return
      open.depth += tag.closing ? -1 : 1
      if (open.depth <= 0) open = null
    },
    /** Each opening tag outside a consent banner. */
    visit(tag: ScannedTag) {
      if (
        open &&
        open.into.length <= HEADER_INNER &&
        HEADER_WRAPPERS.has(tag.name) &&
        !tag.classes.some((c) => OFFSCREEN_NAME.test(c))
      )
        open.into.push(tag.element())
      if (!searching) return
      seen++
      if (tag.name === 'main' || seen > HEADER_SCAN_TAGS) {
        searching = false
        return
      }
      if (open || semantic || tag.void) return
      const isSemantic = tag.name === 'header' || tag.role === 'banner'
      const isNamed =
        !isSemantic && !named && [...tag.classes, tag.id].some((c) => HEADER_NAME.test(c))
      if (!isSemantic && !isNamed) return
      const into = [tag.element()]
      if (isSemantic) semantic = into
      else named = into
      open = { into, depth: 1 }
    },
    /** The header, outermost first, or nothing. */
    result(): PageElement[] {
      return semantic ?? named ?? []
    },
  }
}

/**
 * The declarations an element's `style` attribute writes, and its old
 * `bgcolor` attribute as a background, for the stylesheet reader to resolve.
 */
export function inlineDeclarations(el: PageElement): Map<string, string> {
  const decls = new Map<string, string>()
  for (const part of (el.attrs.style ?? '').split(';')) {
    const at = part.indexOf(':')
    if (at > 0) decls.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim())
  }
  if (!decls.has('background') && !decls.has('background-color') && el.attrs.bgcolor)
    decls.set('background-color', el.attrs.bgcolor)
  return decls
}
