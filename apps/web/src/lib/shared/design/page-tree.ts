/**
 * The page's parts as a tree, as the right panel's "On this page" shows them:
 * the header with its logo and menu items, the hero with its elements, then
 * Home's blocks or the page's own parts, each as the outline lists them (so a
 * part added to the outline shows here too). Each row says what it can do: be
 * hidden, through a show field the design already has, or move, among Home's
 * blocks or the menu's items.
 */
import { composerInHero, drawnMainAction } from './main-action'
import { menuParts, type MenuPartId } from './menu'
import { menuStep, movableParts } from './menu-actions'
import type { DesignerPage, OutlineNode, Selection } from './outline'
import { partsOnPage } from './parts-registry'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'
import { homeBlockTypes, type HomeBlockType } from './home'

export interface TreeRow {
  /** Stable across renders and moves, so focus can find the row again. */
  id: string
  label: string
  /** 1 for the page's own parts, 2 for what is in them. */
  level: number
  /** What a pick selects: the part, or for an element the part it is in. */
  key: Selection
  /** The registered part an element row picks inside `key`, as a canvas click on it does. */
  part?: string
  /** A menu item's id, for its menu actions. */
  menu?: MenuPartId
  blockType?: HomeBlockType
  children?: TreeRow[]
  /** Whether it shows, where it can be hidden; `locked` when it has to stay. */
  hide?: { shown: boolean; locked: boolean }
  /** Where it is drawn when not where the tree puts it: "Shown in the hero". Its row is dimmed. */
  note?: string
  /** Which ways it can move one place, where it can move. */
  move?: { up: boolean; down: boolean }
}

/** Parts the page can hide, each by the show field the design has for it. */
const HIDES: Partial<
  Record<
    Selection,
    {
      name: string
      shown: (design: PortalDesign) => boolean
      set: (draft: PortalDesign, shown: boolean) => void
    }
  >
> = {
  welcome: {
    name: 'Welcome message',
    shown: (design) => design.pages.feedback.welcome.show,
    set: (draft, shown) => void (draft.pages.feedback.welcome.show = shown),
  },
  popular: {
    name: 'Popular articles',
    shown: (design) => design.pages.help?.popular !== false,
    set: (draft, shown) => {
      const help = { ...draft.pages.help }
      // Absent shows them.
      if (shown) delete help.popular
      else help.popular = false
      draft.pages.help = help
    },
  },
}

/** Shows or hides a part through its own show field; false where it has none. */
export function setRowShown(draft: PortalDesign, key: Selection, shown: boolean): boolean {
  const hide = HIDES[key]
  if (!hide) return false
  hide.set(draft, shown)
  return true
}

/** A menu item's selection: a page row by `page:<id>`, a link by its own key. */
const menuKey = (id: MenuPartId): Selection =>
  id.startsWith('link:') ? (id as Selection) : `page:${id as DesignerPage}`

/** The header's logo, then each menu item, which hide and move as the header's panel lets them. */
function headerRows(node: OutlineNode, design: PortalDesign, gates: PortalPageGates): TreeRow[] {
  const own = (node.children ?? []).map((child) => plainRow(child, design, 2))
  const movable = movableParts(design, gates)
  const items = menuParts(design, gates).map((part): TreeRow => {
    const at = movable.indexOf(part.id)
    return {
      id: menuKey(part.id),
      label: part.label,
      level: 2,
      key: menuKey(part.id),
      menu: part.id,
      ...(part.kind === 'link'
        ? {}
        : {
            hide: {
              shown: part.shown,
              locked: part.shown && !menuStep(design, gates, part.id, 'hide'),
            },
          }),
      ...(at < 0 ? {} : { move: { up: at > 0, down: at < movable.length - 1 } }),
    }
  })
  return [...own, ...items]
}

/** The hero's elements the page draws, each picked as a click on it picks it. */
function heroRows(design: PortalDesign, gates: PortalPageGates, page: DesignerPage): TreeRow[] {
  const action = page === 'home' ? drawnMainAction(design.pages.home, gates) : 'none'
  const drawn: Record<string, boolean> = {
    headline: true,
    subtitle: true,
    image: !!design.brand.heroImage,
    composer: action === 'composer',
    cta: action === 'button',
  }
  const prefix = `hero.${page}.`
  return partsOnPage(design, page as Parameters<typeof partsOnPage>[1])
    .filter((part) => part.id.startsWith(prefix) && drawn[part.id.slice(prefix.length)])
    .map((part) => ({
      id: `part:${part.id}`,
      label: part.label,
      level: 2,
      key: 'hero' as Selection,
      part: part.id,
    }))
}

/** An outline part as a row, with an eye where it has a show field, and its own parts under it. */
function plainRow(node: OutlineNode, design: PortalDesign, level: number): TreeRow {
  const hide = HIDES[node.key]
  return {
    id: node.key,
    label: hide?.name ?? node.label,
    level,
    key: node.key,
    ...(node.blockType ? { blockType: node.blockType } : {}),
    ...(hide ? { hide: { shown: hide.shown(design), locked: false } } : {}),
    ...(node.children?.length
      ? { children: node.children.map((child) => plainRow(child, design, level + 1)) }
      : {}),
  }
}

/** The note on Home's composer block while the hero draws it. */
export const SHOWN_IN_HERO = 'Shown in the hero'

/** The page's parts as a tree, in the order a visitor meets them. */
export function pageTree(
  design: PortalDesign,
  gates: PortalPageGates,
  page: DesignerPage,
  nodes: readonly OutlineNode[]
): TreeRow[] {
  return nodes
    .filter((node) => node.key !== 'site')
    .map((node) => {
      const row = plainRow(node, design, 1)
      if (node.key === 'header') return { ...row, children: headerRows(node, design, gates) }
      if (node.key === 'hero') {
        const children = heroRows(design, gates, page)
        return children.length ? { ...row, children } : row
      }
      if (node.key === 'home' && row.children) {
        const count = row.children.length
        // The composer block is drawn in the hero, not on the grid, while the hero has it.
        const inHero =
          composerInHero(design.pages.home) && homeBlockTypes(gates).includes('composer')
        return {
          ...row,
          children: row.children.map((child, at) => ({
            ...child,
            move: { up: at > 0, down: at < count - 1 },
            ...(inHero && child.blockType === 'composer' ? { note: SHOWN_IN_HERO } : {}),
          })),
        }
      }
      return row
    })
}

/** Every row, children after their parent; with `open`, only children of the open rows. */
export function treeRows(rows: readonly TreeRow[], open?: ReadonlySet<string>): TreeRow[] {
  return rows.flatMap((row) => [
    row,
    ...(row.children && (!open || open.has(row.id)) ? treeRows(row.children, open) : []),
  ])
}
