/**
 * The parts a design can style one at a time ("this one"): a curated list of
 * the portal's single things, each with a stable name, never a DOM path. A
 * part is found on the page by the portal's own public marks: the page it
 * is on (`data-qb-page`), its section (`data-qb-section`), its part
 * (`data-qb-part`, the names a workspace's CSS uses) and the menu's items
 * (`data-qb-menu`). Repeated content, such as one post card among many, is
 * not a part: it is styled for its page or everywhere.
 *
 * Each part says what it is called, the element kind or kinds it is, the
 * pages it is on, and where it is: its anchor, either the element itself or
 * a container the element sits in.
 */
import { ITEM_NAMES, ITEMS_OF, type ContentKind } from './content-kinds'
import { BLOCK_NAMES, PAGE_NAMES } from './names'
import type { PortalDesign } from './schema'
import { DESIGN_OPTIONS } from './options'
import { STYLE_ELEMENTS, type StyleElement, type StyleElementInfo } from './style-tokens'
import type { OverridePage } from './style-overrides'

export interface PartInfo {
  id: string
  /** Its name, as the builder says it: "Call to action". */
  label: string
  /** What it belongs to: "Hero · Home", "Header", a block's name. */
  group: string
  /** The element kinds it is (or holds, for a container anchor). */
  elements: readonly StyleElement[]
  /** The pages it is on. */
  pages: readonly OverridePage[]
  /** Where it is, under the portal's root. */
  anchor: string
  /** Whether the anchor is a container the element sits in, rather than the element. */
  within: boolean
  /**
   * Whether the anchor names the element itself, whatever its element kind's
   * own marks: a listed item, a data block's or a list page's, styled as
   * text. Its part styles every item of its kind where it is listed, and is
   * the one scope that reaches it.
   */
  exact?: boolean
  /** Who owns what it says: the design (static), the workspace's data (dynamic) or the product (system). */
  kind: ContentKind
  /** The Home block it is in. */
  block?: string
  /** The source files that draw its marks, under `apps/web/src`. */
  files: readonly string[]
}

const ALL_PAGES = DESIGN_OPTIONS.backgroundPage
const HEADER = 'components/public/portal-header.tsx'
const BAND = 'components/public/portal-band.tsx'
const TITLE = 'components/public/portal-page-title.tsx'
const COMPOSER = 'components/public/feedback/feedback-header-animated.tsx'

/** Pages with a hero: Home and Feedback draw the band, the others a title that may sit on one. */
const HERO_PAGES = ['home', 'feedback', 'roadmap', 'changelog', 'help', 'support'] as const
/** Pages whose hero holds the composer and its call to action. */
const COMPOSER_PAGES = ['home'] as const
/** Pages whose title has a button of its own beside it. */
const ACTION_PAGES = ['changelog', 'support'] as const

/** A block's slots: the single things in it, by the element kind each is. */
export const BLOCK_SLOTS = ['heading', 'body', 'link', 'button', 'input'] as const
export type BlockSlot = (typeof BLOCK_SLOTS)[number]
const SLOT_NAMES: Record<BlockSlot, string> = {
  heading: 'Heading',
  body: 'Text',
  link: 'Link',
  button: 'Button',
  input: 'Field',
}
/** Who owns each slot's words: the block's own words are the design's, its field the product's. */
const SLOT_KINDS: Record<BlockSlot, ContentKind> = {
  heading: 'static',
  body: 'static',
  link: 'static',
  button: 'static',
  input: 'system',
}
/** The slots each block type draws. */
const SLOTS_OF: Record<string, readonly BlockSlot[]> = {
  welcome: ['heading', 'body'],
  composer: ['input', 'button'],
  ideas: ['heading', 'link'],
  roadmap: ['heading', 'link'],
  updates: ['heading', 'link'],
  help_search: ['heading', 'input'],
  help_topics: ['heading', 'link'],
  status: ['heading', 'link'],
  contact: ['heading', 'button'],
  links: ['heading', 'link'],
  boards: ['heading', 'link'],
}

const at = (page: string, rest: string) => `[data-qb-page=${page}] ${rest}`

/** Every part a design has, in the order a visitor meets them. */
export function partsOf(design: PortalDesign): PartInfo[] {
  const parts: PartInfo[] = []
  parts.push({
    id: 'header.login',
    label: 'Log in button',
    group: 'Header',
    elements: ['button', 'ghost', 'secondary'],
    pages: ALL_PAGES,
    anchor: '[data-qb-menu=sign-in]',
    within: false,
    kind: 'system',
    files: [HEADER],
  })
  const navItems: Array<[string, string, string]> = []
  if (design.nav.home.on && design.nav.home.tab)
    navItems.push(['nav.home', 'home', design.nav.home.label ?? 'Home'])
  for (const item of design.nav.items) {
    if (item.type === 'link') navItems.push([`nav.link.${item.id}`, `link:${item.id}`, item.label])
    else if (item.shown)
      navItems.push([`nav.${item.type}`, item.type, item.label ?? PAGE_NAMES[item.type]])
  }
  for (const [id, menu, label] of navItems)
    parts.push({
      id,
      label: `Menu item · ${label}`,
      group: 'Menu',
      elements: ['navItem'],
      pages: ALL_PAGES,
      anchor: `[data-qb-menu="${menu}"]`,
      within: false,
      kind: 'static',
      files: [HEADER],
    })
  for (const page of HERO_PAGES) {
    const group = `Hero · ${PAGE_NAMES[page]}`
    const files = page === 'home' || page === 'feedback' ? [BAND] : [BAND, TITLE]
    parts.push(
      {
        id: `hero.${page}.headline`,
        label: 'Headline',
        group,
        elements: ['headline'],
        pages: [page],
        anchor: at(page, '[data-qb-section=hero] [data-qb-part=headline]'),
        within: false,
        kind: 'static',
        files,
      },
      {
        id: `hero.${page}.subtitle`,
        label: 'Subtitle',
        group,
        elements: ['subtitle'],
        pages: [page],
        anchor: at(page, '[data-qb-section=hero] [data-qb-part=subtitle]'),
        within: false,
        kind: 'static',
        files,
      },
      {
        id: `hero.${page}.image`,
        label: 'Image',
        group,
        elements: ['image'],
        pages: [page],
        anchor: at(page, '[data-qb-section=hero] [data-qb-part=band-image]'),
        within: true,
        kind: 'static',
        files: [BAND],
      }
    )
    if ((COMPOSER_PAGES as readonly string[]).includes(page))
      parts.push(
        {
          id: `hero.${page}.composer`,
          label: 'Composer',
          group,
          elements: ['input'],
          pages: [page],
          anchor: at(page, '[data-qb-section=hero] [data-qb-part=composer]'),
          within: false,
          kind: 'system',
          files: [BAND, COMPOSER],
        },
        {
          id: `hero.${page}.cta`,
          label: 'Call to action',
          group,
          elements: ['button'],
          pages: [page],
          anchor: at(page, '[data-qb-section=hero] [data-qb-action]'),
          within: false,
          kind: 'static',
          files: [BAND, COMPOSER],
        }
      )
    if ((ACTION_PAGES as readonly string[]).includes(page))
      parts.push({
        id: `title.${page}.action`,
        label: 'Title button',
        group,
        elements: ['button', 'secondary', 'ghost'],
        pages: [page],
        anchor: at(page, '[data-qb-section=hero] [data-qb-part=title-action]'),
        within: true,
        kind: 'static',
        files: [TITLE],
      })
  }
  for (const block of design.pages.home.blocks) {
    if (!block.id) continue
    const name = blockName(block)
    for (const slot of SLOTS_OF[block.type] ?? [])
      parts.push({
        id: `block.${block.id}.${slot}`,
        label: SLOT_NAMES[slot],
        group: name,
        elements: [slot === 'button' ? 'button' : slot],
        pages: ['home'],
        anchor: `[data-qb-section="block-${block.id}"]`,
        within: true,
        kind: SLOT_KINDS[slot],
        block: block.id,
        files: ['components/public/home/home-blocks.tsx'],
      })
  }
  parts.push(
    {
      id: 'feed.filters',
      label: 'Filters',
      group: 'Feedback',
      elements: ['panel'],
      pages: ['feedback'],
      anchor: at('feedback', '[data-qb-part=filter-panel]'),
      within: true,
      kind: 'system',
      files: ['components/public/feedback/feedback-sidebar.tsx'],
    },
    {
      id: 'feed.submit',
      label: 'Submit button',
      group: 'Feedback',
      elements: ['button'],
      pages: ['feedback'],
      anchor: at('feedback', '[data-qb-section=feed] [data-qb-part=composer]'),
      within: true,
      kind: 'system',
      files: ['components/public/feedback/feedback-container.tsx', COMPOSER],
    },
    {
      id: 'post.vote',
      label: 'Vote box',
      group: 'Post',
      elements: ['vote'],
      pages: ['post'],
      anchor: at('post', '[data-qb-part=vote-button]'),
      within: false,
      kind: 'system',
      files: ['components/public/vote-button.tsx'],
    },
    {
      id: 'footer',
      label: 'Footer',
      group: 'Footer',
      elements: ['footer'],
      pages: ALL_PAGES,
      anchor: '[data-qb-section=footer]',
      within: false,
      kind: 'static',
      files: ['components/public/portal-footer.tsx'],
    }
  )
  return parts
}

/** A block's name, as the builder says it: its own title or heading, else its type's. */
function blockName(block: PortalDesign['pages']['home']['blocks'][number]): string {
  return (
    ('title' in block && block.title) ||
    block.heading?.en ||
    Object.values(block.heading ?? {})[0] ||
    BLOCK_NAMES[block.type]
  )
}

/**
 * The items list pages draw, by the section that lists them and the mark on
 * each: the Feedback feed's post titles and excerpts, the roadmap's titles.
 * Picked, one is itself, as a Home block's item is, not the card around it.
 */
const LIST_ITEMS: ReadonlyArray<{
  section: string
  group: string
  page: OverridePage
  mark: string
  label: string
  file: string
}> = [
  {
    section: 'feed',
    group: 'Feed',
    page: 'feedback',
    mark: 'post-title',
    label: 'Post title',
    file: 'components/public/post-card.tsx',
  },
  {
    section: 'feed',
    group: 'Feed',
    page: 'feedback',
    mark: 'post-excerpt',
    label: 'Post excerpt',
    file: 'components/public/post-card.tsx',
  },
  {
    section: 'board',
    group: 'Board',
    page: 'roadmap',
    mark: 'post-title',
    label: 'Post title',
    file: 'components/public/roadmap-card.tsx',
  },
]

/**
 * The items a design's data blocks and list pages list, one part for each
 * kind of item where it is listed: picking one post's title styles every
 * post title there. They are the workspace's data, picked on the canvas,
 * and kept out of the parts the AI is told of.
 */
export function itemPartsOf(design: PortalDesign): PartInfo[] {
  const parts: PartInfo[] = []
  for (const block of design.pages.home.blocks) {
    if (!block.id) continue
    for (const item of ITEMS_OF[block.type] ?? [])
      parts.push({
        id: `block.${block.id}.${item}`,
        label: ITEM_NAMES[item],
        group: blockName(block),
        elements: ['body'],
        pages: ['home'],
        anchor: `[data-qb-section="block-${block.id}"] [data-qb-item="${item}"]`,
        within: false,
        exact: true,
        kind: 'dynamic',
        block: block.id,
        files: ['components/public/home/home-blocks.tsx'],
      })
  }
  for (const item of LIST_ITEMS)
    parts.push({
      id: `${item.section}.${item.mark}`,
      label: item.label,
      group: item.group,
      elements: ['body'],
      pages: [item.page],
      anchor: `[data-qb-section=${item.section}] [data-qb-part=${item.mark}]`,
      within: false,
      exact: true,
      kind: 'dynamic',
      files: [item.file],
    })
  return parts
}

/** Every part a design has: its single things and its data blocks' items. */
export function allPartsOf(design: PortalDesign): PartInfo[] {
  return [...partsOf(design), ...itemPartsOf(design)]
}

/** A part of a design by its name, or null where the design no longer has it. */
export function partOf(design: PortalDesign, id: string): PartInfo | null {
  return allPartsOf(design).find((part) => part.id === id) ?? null
}

/** The parts on a page. */
export function partsOnPage(design: PortalDesign, page: OverridePage): PartInfo[] {
  return allPartsOf(design).filter((part) => part.pages.includes(page))
}

/**
 * Where a part's element is, under the portal's root: the anchor as that
 * element, or the element inside it.
 */
export function partSelector(
  part: Pick<PartInfo, 'anchor' | 'within' | 'exact'>,
  element: StyleElement
): string {
  if (part.exact) return part.anchor
  const el: StyleElementInfo = STYLE_ELEMENTS[element]
  return part.within ? `${part.anchor} ${el.selector}` : `${part.anchor}:is(${el.selector})`
}
