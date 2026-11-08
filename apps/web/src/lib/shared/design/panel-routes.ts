/**
 * What the right panel shows for a pick, in one table: the panel, its
 * breadcrumb, and the level Escape goes up to. Nothing picked shows the
 * page's own panel, and so does a pick with no panel of its own, so the
 * panel is never blank. Escape climbs one level at a time: an element to its
 * block, a Home block to Blocks, a menu link or the logo to the header, anything else to
 * the page; only the page closes the panel.
 */
import { sectionTypeOf } from './builder-chrome'
import { isMenuSelection } from './menu'
import { PAGE_NAMES, type DesignerPage, type Selection } from './outline'

/** The panels the right panel holds. */
export type PanelKind =
  | 'page'
  | 'words'
  | 'header'
  | 'logo'
  | 'link'
  | 'hero'
  | 'blocks'
  | 'block'
  | 'section'
  | 'part'
  | 'element'

/** A step of the breadcrumb: `to` picks it (null is the page); the last has none. */
export interface RouteCrumb {
  label: string
  to?: Selection | null
}

export interface PanelRoute {
  panel: PanelKind
  crumbs: RouteCrumb[]
  /** What Escape picks: a parent, null for the page, or 'close' from the page itself. */
  up: Selection | null | 'close'
}

/** Each panel's own name, where the outline does not give one. */
const OWN_NAMES: Partial<Record<string, string>> = {
  header: 'Header and menu',
  logo: 'Logo',
  hero: 'Hero',
  home: 'Blocks',
  'site:words': 'Words',
  welcome: 'Welcome message',
  feed: 'Feed',
  filters: 'Filters',
  entries: 'Entries',
  topics: 'Topics',
  popular: 'Popular articles',
  board: 'Board',
}

const PARTS = new Set(['welcome', 'feed', 'filters'])

/** The level above a pick: a Home block's is Blocks, a menu link's and the logo's the header, the rest the page. */
export function upOf(selection: string | null): Selection | null {
  if (!selection) return null
  if (selection.startsWith('block-')) return 'home'
  if (selection.startsWith('link:') || selection === 'logo') return 'header'
  return null
}

/**
 * The panel for a pick, with `element` whether an element in it is picked
 * too, on `page`; `nameOf` names a pick as the outline does.
 */
export function panelFor(
  selection: Selection | null,
  element: boolean,
  page: DesignerPage,
  nameOf: (key: Selection | null) => string | undefined = () => undefined
): PanelRoute {
  const pageCrumb: RouteCrumb = { label: PAGE_NAMES[page], to: null }
  const named = (key: Selection) => nameOf(key) ?? OWN_NAMES[key] ?? key
  const under = (panel: PanelKind, key: Selection, parents: RouteCrumb[] = []): PanelRoute => ({
    panel,
    crumbs: [pageCrumb, ...parents, { label: named(key) }],
    up: upOf(key),
  })
  const pagePanel = (up: PanelRoute['up']): PanelRoute => ({
    panel: 'page',
    crumbs: [{ label: PAGE_NAMES[page] }],
    up,
  })
  if (!selection) return pagePanel('close')
  if (element) return { ...under('element', selection), up: selection }
  if (selection === 'header' || (isMenuSelection(selection) && !selection.startsWith('link:')))
    return { ...under('header', 'header'), up: null }
  if (selection.startsWith('link:'))
    return under('link', selection, [{ label: named('header'), to: 'header' }])
  if (selection === 'logo')
    return under('logo', selection, [{ label: named('header'), to: 'header' }])
  if (selection === 'site:words') return under('words', selection)
  if (selection === 'hero') return under('hero', selection)
  if (selection === 'home') return under('blocks', selection)
  if (selection.startsWith('block-'))
    return under('block', selection, [{ label: named('home'), to: 'home' }])
  if (sectionTypeOf(selection)) return under('section', selection)
  if (PARTS.has(selection)) return under('part', selection)
  return pagePanel(null)
}
