/**
 * The designer's outline: what a page shows, in the order a visitor meets it,
 * each part named the way Appearance names it. A part's key is the
 * `data-qb-section` the portal marks it with, so a click on the canvas and a
 * row in the outline select the same thing.
 */
import { PAGE_PATHS, type DesignerPage, type PortalPageGates, type PortalPageType } from './paths'

export {
  locationOfPath,
  pageOfPath,
  pagePath,
  type CanvasLocation,
  type DesignerPage,
} from './paths'
import type { PortalDesign } from './schema'
import type { HomeBlock, HomeBlockType } from './home'
import { BLOCK_NAMES, PAGE_NAMES } from './names'

export { BLOCK_NAMES, PAGE_NAMES }

/** What is selected: the site's styles, or a part of the page. */
export type Selection =
  | 'site'
  /** A part of the site's styles, such as its colours; see SITE_PARTS. */
  | `site:${SitePart}`
  | 'header'
  /** The header's logo, its own element on every page. */
  | 'logo'
  /** The top of each page, with its headline: one block on every page that has one. */
  | 'hero'
  | 'welcome'
  /** The feed's composer: its prompt and button, edited where they sit. */
  | 'composer'
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
 * The parts of the site's styles: what the customer brings and how the
 * portal uses it, both in Theme. Words are edited where each page draws them.
 */
export const SITE_PARTS = {
  brand: 'Brand kit',
  styles: 'Styles',
} as const
export type SitePart = keyof typeof SITE_PARTS

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
    { key: 'site', label: 'Every page' },
    { key: 'header', label: 'Header and menu', children: [{ key: 'logo', label: 'Logo' }] },
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
    nodes.push({ key: 'composer', label: 'Composer' })
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
