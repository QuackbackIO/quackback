/**
 * The designer's outline: what a page shows, in the order a visitor meets it,
 * each part named the way Appearance names it. A part's key is the
 * `data-qb-section` the portal marks it with, so a click on the canvas and a
 * row in the outline select the same thing.
 */
import { PAGE_PATHS, type PortalPageGates, type PortalPageType } from './paths'
import type { PortalDesign } from './schema'
import type { HomeBlock, HomeBlockType } from './home'
import { BLOCK_NAMES, PAGE_NAMES } from './names'

export { BLOCK_NAMES, PAGE_NAMES }

/** A page the designer can show: Home, one of the portal's own pages, or a post. */
export type DesignerPage = 'home' | PortalPageType | 'post'

/** What is selected: the site's styles, or a part of the page. */
export type Selection =
  | 'site'
  /** A part of the site's styles, such as its colours; see SITE_PARTS. */
  | `site:${SitePart}`
  | 'header'
  /** The top of each page, with its headline: one block on every page that has one. */
  | 'hero'
  | 'welcome'
  | 'feed'
  | 'filters'
  | 'home'
  /** The changelog's entries; the help center's topics and popular articles; the roadmap's board. */
  | 'entries'
  | 'topics'
  | 'popular'
  | 'board'
  | `block-${string}`
  /** A part of the menu or a page under one, such as `page:help` or `page:post`; see menu.ts. */
  | `page:${DesignerPage}`
  /** A link in the menu, by its id. */
  | `link:${string}`

/**
 * The parts of the site's styles, each its own row under them: what the
 * customer brings, how the portal uses it, its words and its readability.
 */
export const SITE_PARTS = {
  brand: 'Brand kit',
  styles: 'Styles',
  words: 'Words',
} as const
export type SitePart = keyof typeof SITE_PARTS

/** The site parts the outline lists; the brand kit and styles open panels of their own. */
const OUTLINE_SITE_PARTS: SitePart[] = ['words']

export interface OutlineNode {
  key: Selection
  label: string
  children?: OutlineNode[]
  /** A Home block's type, for its icon. */
  blockType?: HomeBlockType
  /** The type's name, when the block's heading names it otherwise. */
  typeName?: string
  /** Whether a row that can hold others shows them; absent for a row that cannot. */
  expanded?: boolean
}

/** A Home block's key; every block has an id once the design has been read. */
export function blockKey(block: HomeBlock, index: number): Selection {
  return `block-${block.id ?? index}`
}

/** The pages the designer offers: Home while it is on, then each page the workspace has. */
export function designerPages(design: PortalDesign, gates: PortalPageGates): DesignerPage[] {
  const pages: DesignerPage[] = (Object.keys(PAGE_PATHS) as PortalPageType[]).filter(
    (page) => gates[page]
  )
  // A post shows how the feed's cards open, so it comes with Feedback.
  if (gates.feedback) pages.splice(pages.indexOf('feedback') + 1, 0, 'post')
  return design.nav.home.on ? ['home', ...pages] : pages
}

/** Where the canvas is: a page, and the item it shows, such as a post or an entry, if any. */
export interface CanvasLocation {
  page: DesignerPage
  /** The item's own address; null for the page itself. */
  item: string | null
}

/** The page a portal path shows and its item, or null for one the designer does not draw. */
export function locationOfPath(path: string, homeOn: boolean): CanvasLocation | null {
  const pathname = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/'
  if (pathname === '/') return { page: homeOn ? 'home' : 'feedback', item: null }
  if (/^\/b\/[^/]+\/posts\/[^/]+$/.test(pathname)) return { page: 'post', item: pathname }
  const found = (Object.entries(PAGE_PATHS) as Array<[PortalPageType, string]>).find(
    ([, at]) => pathname === at || pathname.startsWith(`${at}/`)
  )
  if (!found) return null
  const [page, at] = found
  return { page, item: pathname === at ? null : pathname }
}

/** The page a portal path shows, a detail page under its own, or null for one the designer does not draw. */
export function pageOfPath(path: string, homeOn: boolean): DesignerPage | null {
  return locationOfPath(path, homeOn)?.page ?? null
}

/** The address the canvas loads a page at: the item it shows, else the page's own. */
export function pagePath(page: DesignerPage, item: string | null = null): string {
  if (item) return item
  if (page === 'post') return '/'
  return page === 'home' ? '/' : PAGE_PATHS[page]
}

/** Each page's own sections under its title, in the order a visitor meets them. */
const PAGE_SECTIONS: Record<
  'roadmap' | 'changelog' | 'help' | 'support',
  (design: PortalDesign) => OutlineNode[]
> = {
  roadmap: () => [{ key: 'board', label: 'Board' }],
  changelog: () => [{ key: 'entries', label: 'Entries' }],
  help: (design) => [
    { key: 'topics', label: 'Topics' },
    // Listed when off too, so it can be turned back on.
    {
      key: 'popular',
      label: design.pages.help?.popular === false ? 'Popular articles (off)' : 'Popular articles',
    },
  ],
  support: () => [],
}

/** The parts of a page, in the order a visitor meets them, after what every page shares. */
export function outlineOf(design: PortalDesign, page: DesignerPage): OutlineNode[] {
  const nodes: OutlineNode[] = [
    {
      key: 'site',
      label: 'Every page',
      children: OUTLINE_SITE_PARTS.map((part) => ({
        key: `site:${part}` as const,
        label: SITE_PARTS[part],
      })),
    },
    { key: 'header', label: 'Header and menu' },
  ]
  // Every page with a headline has a hero; the status page and a post do not.
  if (page !== 'status' && page !== 'post') nodes.push({ key: 'hero', label: 'Hero' })
  if (page === 'home') {
    nodes.push({
      key: 'home',
      label: 'Blocks',
      children: design.pages.home.blocks.map((block, index) => {
        const typeName = BLOCK_NAMES[block.type]
        const label =
          block.heading?.en ?? Object.values(block.heading ?? {}).find(Boolean) ?? typeName
        return {
          key: blockKey(block, index),
          label,
          blockType: block.type,
          ...(label === typeName ? {} : { typeName }),
        }
      }),
    })
  } else if (page === 'feedback') {
    // Listed when off too, so it can be turned back on.
    nodes.push({
      key: 'welcome',
      label: design.pages.feedback.welcome.show ? 'Welcome message' : 'Welcome (off)',
    })
    nodes.push({ key: 'feed', label: 'Feed' })
    nodes.push({ key: 'filters', label: 'Filters' })
  } else if (page !== 'status' && page !== 'post') {
    nodes.push(...PAGE_SECTIONS[page](design))
  }
  return nodes
}

/** Every key in an outline, in order, children after their parent. */
export function outlineKeys(nodes: readonly OutlineNode[]): Selection[] {
  return nodes.flatMap((node) => [node.key, ...outlineKeys(node.children ?? [])])
}
