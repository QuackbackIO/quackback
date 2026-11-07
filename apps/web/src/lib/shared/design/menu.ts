/**
 * The customer portal's menu as the builder edits it: one part
 * per entry, in the order visitors see them, each with the visitor's label
 * and the admin's name. Where visitors land follows `portalLanding`: Home
 * while it is on, else the first page the menu shows, so landing on a page
 * moves it to the top of the menu and turns Home off.
 */
import { isProductEnabled } from '@/lib/shared/types/settings'
import { settleHome, starterHomeBlocks, type HomeBlockType } from './home'
import { PAGE_NAMES, type DesignerPage, type Selection } from './outline'
import {
  PAGE_PATHS,
  portalFeedbackPath,
  type PageGateSettings,
  type PortalPageGates,
  type PortalPageType,
} from './paths'
import type { PortalDesign } from './schema'

type NavItem = PortalDesign['nav']['items'][number]
type PageItem = Extract<NavItem, { shown: boolean }>
type LinkItem = Extract<NavItem, { type: 'link' }>

/** A part of the menu: Home, a page, or a link, by `link:<id>`. */
export type MenuPartId = 'home' | PortalPageType | `link:${string}`

/** The order the portal appends pages a stored menu leaves out. */
const PAGE_ORDER: PortalPageType[] = [
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
]

export interface MenuPart {
  id: MenuPartId
  kind: 'home' | 'page' | 'link'
  /** What visitors see in the menu. */
  label: string
  /** The admin's name for it, when the label says something else. */
  adminName: string | null
  /** Whether the menu shows it. A link always shows. */
  shown: boolean
  /** Whether visitors and the logo land here. */
  lands: boolean
  /** The address it opens: a page's path, a link's URL. */
  href: string
}

/** The menu part a selection names, if it names one. */
export function menuPartOf(selection: Selection | null): MenuPartId | null {
  if (!selection) return null
  if (selection.startsWith('link:')) return selection as MenuPartId
  if (!selection.startsWith('page:')) return null
  const page = selection.slice('page:'.length)
  return page === 'home' || page in PAGE_PATHS ? (page as MenuPartId) : null
}

/** Whether a selection is a row of the menu or a page of it, such as A post. */
export function isMenuSelection(selection: string | null): boolean {
  return !!selection && (selection.startsWith('page:') || selection.startsWith('link:'))
}

/** The designer page a page row opens. */
export function pageOfSelection(selection: Selection | null): DesignerPage | null {
  if (!selection?.startsWith('page:')) return null
  const page = selection.slice('page:'.length)
  return page in PAGE_NAMES ? (page as DesignerPage) : null
}

/**
 * The menu's entries in the order the portal resolves them: stored order,
 * parts that are off left out, and pages the stored menu leaves out added
 * last, as the portal adds them.
 */
function entries(design: PortalDesign, gates: PortalPageGates): NavItem[] {
  const listed = design.nav.items.filter((item) => item.type === 'link' || gates[item.type])
  const missing = PAGE_ORDER.filter(
    (type) => gates[type] && !design.nav.items.some((item) => item.type === type)
  ).map((type): PageItem => ({ type, shown: true }))
  return [...listed, ...missing]
}

/** Puts every page in the stored menu, as the portal already shows them, so edits have a place. */
function fillIn(design: PortalDesign): void {
  for (const type of PAGE_ORDER)
    if (!design.nav.items.some((item) => item.type === type))
      design.nav.items.push({ type, shown: true })
}

const idOf = (item: NavItem): MenuPartId => (item.type === 'link' ? `link:${item.id}` : item.type)

/** Where `/` takes visitors: Home, or the first page the menu shows. */
export function landingOf(design: PortalDesign, gates: PortalPageGates): 'home' | PortalPageType {
  if (design.nav.home.on) return 'home'
  const first = entries(design, gates).find(
    (item): item is PageItem => item.type !== 'link' && item.shown
  )
  return first?.type ?? 'feedback'
}

/**
 * The part that leads a newly started Home: the first page the menu shows,
 * else the first that is on. Null when no part is on.
 */
export function leadingPart(design: PortalDesign, gates: PortalPageGates): PortalPageType | null {
  const pages = entries(design, gates).filter((item): item is PageItem => item.type !== 'link')
  return (pages.find((item) => item.shown) ?? pages[0])?.type ?? null
}

/** The parts of the menu, Home first while it is on. */
export function menuParts(design: PortalDesign, gates: PortalPageGates): MenuPart[] {
  const landing = landingOf(design, gates)
  const { home } = design.nav
  const parts: MenuPart[] = home.on
    ? [
        {
          id: 'home',
          kind: 'home',
          label: home.label ?? 'Home',
          adminName: home.label && home.label !== 'Home' ? 'Home' : null,
          shown: home.tab,
          lands: true,
          href: '/',
        },
      ]
    : []
  const feedbackPath = portalFeedbackPath({ engine: 'v2', nav: design.nav }, gates)
  for (const item of entries(design, gates)) {
    if (item.type === 'link') {
      parts.push({
        id: idOf(item),
        kind: 'link',
        label: item.label,
        adminName: null,
        shown: true,
        lands: false,
        href: item.url,
      })
      continue
    }
    const name = PAGE_NAMES[item.type]
    parts.push({
      id: item.type,
      kind: 'page',
      label: item.label ?? name,
      adminName: item.label && item.label !== name ? name : null,
      shown: item.shown,
      lands: landing === item.type,
      href: item.type === 'feedback' ? feedbackPath : PAGE_PATHS[item.type],
    })
  }
  return parts
}

/** Where visitors can land: Home, which turns it on, and each part that is on. */
export function landingOptions(
  design: PortalDesign,
  gates: PortalPageGates
): Array<'home' | PortalPageType> {
  return [
    'home',
    ...entries(design, gates)
      .filter((item): item is PageItem => item.type !== 'link')
      .map((item) => item.type),
  ]
}

/**
 * Lands visitors on a part. Home turns on, starting with blocks from the
 * parts that are on when it has none. A page moves to the top of the menu,
 * shows, and Home turns off, since Home always leads while it is on.
 */
export function setLanding(
  design: PortalDesign,
  gates: PortalPageGates,
  target: 'home' | PortalPageType
): void {
  if (target === 'home') {
    design.nav.home.on = true
    if (design.pages.home.blocks.length === 0)
      design.pages.home.blocks = starterHomeBlocks(gates, leadingPart(design, gates))
    return
  }
  fillIn(design)
  const at = design.nav.items.findIndex((item) => item.type === target)
  const [item] = design.nav.items.splice(at, 1) as [PageItem]
  design.nav.items.unshift({ ...item, shown: true })
  design.nav.home.on = false
}

/**
 * Shows a part in the menu or hides it; Home's tab for Home. The page
 * visitors land on stays while Home is off, since hiding it would move them:
 * false when nothing changed for that reason.
 */
export function setMenuShown(
  design: PortalDesign,
  gates: PortalPageGates,
  id: MenuPartId,
  shown: boolean
): boolean {
  if (id === 'home') {
    design.nav.home.tab = shown
    return true
  }
  if (id.startsWith('link:')) return false
  if (!shown && !design.nav.home.on && landingOf(design, gates) === id) return false
  fillIn(design)
  const item = design.nav.items.find((each) => each.type === id) as PageItem
  item.shown = shown
  return true
}

/** The Home blocks that show each part. */
const PART_BLOCKS: Record<PortalPageType, HomeBlockType[]> = {
  feedback: ['composer', 'ideas'],
  roadmap: ['roadmap'],
  changelog: ['updates'],
  help: ['help_search', 'help_topics'],
  support: ['contact'],
  status: ['status'],
}

/**
 * What still reaches a page hidden from the menu: its address, and the ids
 * of the Home blocks that show it while Home is on. Null for a part shown.
 */
export function hiddenNote(
  design: PortalDesign,
  gates: PortalPageGates,
  id: MenuPartId
): { path: string; blocks: string[] } | null {
  const part = menuParts(design, gates).find((each) => each.id === id)
  if (!part || part.shown || part.kind !== 'page') return null
  const types = PART_BLOCKS[id as PortalPageType]
  const blocks = design.nav.home.on
    ? design.pages.home.blocks.flatMap((block, index) =>
        types.includes(block.type) ? [block.id ?? String(index)] : []
      )
    : []
  return { path: part.href, blocks }
}

/** Takes off Home every block that shows a part. */
export function removeHomeBlocksOf(design: PortalDesign, type: PortalPageType): void {
  const types = PART_BLOCKS[type]
  design.pages.home.blocks = design.pages.home.blocks.filter((block) => !types.includes(block.type))
  settleHome(design)
}

/**
 * Moves a part to a place among the parts that can move (every part but
 * Home), counted as the menu reads now. Pages that are off keep their places.
 */
export function moveMenuPart(
  design: PortalDesign,
  gates: PortalPageGates,
  id: MenuPartId,
  place: number
): void {
  if (id === 'home') return
  fillIn(design)
  const slots = design.nav.items.flatMap((item, at) =>
    item.type === 'link' || gates[item.type] ? [at] : []
  )
  const moving = slots.map((at) => design.nav.items[at]!)
  const from = moving.findIndex((item) => idOf(item) === id)
  if (from < 0) return
  const [item] = moving.splice(from, 1)
  moving.splice(Math.max(0, Math.min(place, moving.length)), 0, item!)
  slots.forEach((at, index) => (design.nav.items[at] = moving[index]!))
}

/**
 * Renames a part in the menu. An empty name gives Home or a page back its
 * own; a link always keeps one.
 */
export function renameMenuPart(design: PortalDesign, id: MenuPartId, name: string): void {
  const label = name.trim().slice(0, 40)
  if (id === 'home') {
    if (label) design.nav.home.label = label
    else delete design.nav.home.label
    return
  }
  if (id.startsWith('link:')) {
    const link = linkOf(design, id)
    if (link && label) link.label = label
    return
  }
  fillIn(design)
  const item = design.nav.items.find((each) => each.type === id) as PageItem
  if (label) item.label = label
  else delete item.label
}

/** A link in the menu by its part id. */
export function linkOf(design: PortalDesign, id: MenuPartId): LinkItem | undefined {
  return design.nav.items.find(
    (item): item is LinkItem => item.type === 'link' && `link:${item.id}` === id
  )
}

/** At most this many entries in the stored menu, pages included. */
export const MENU_MAX = 16

/** Adds a link to the end of the menu, opening in a new tab; its id. */
export function addMenuLink(design: PortalDesign, link: { label: string; url: string }): string {
  fillIn(design)
  const id = crypto.randomUUID()
  design.nav.items.push({
    type: 'link',
    id,
    label: link.label.trim(),
    url: link.url.trim(),
    newTab: true,
  })
  return id
}

/** Takes a link out of the menu. */
export function removeMenuLink(design: PortalDesign, id: MenuPartId): void {
  design.nav.items = design.nav.items.filter(
    (item) => item.type !== 'link' || `link:${item.id}` !== id
  )
}

/** Whether a link's address is one the menu takes: http or https. */
export function isMenuLinkUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(url.trim())
}

export interface OffPart {
  type: PortalPageType
  name: string
  /** One line on what it does. */
  does: string
  /** Where it is turned on: the module list, or the part's own settings for a page switch. */
  href: string
}

const DOES: Record<PortalPageType, string> = {
  feedback: 'Visitors post ideas and vote on them.',
  roadmap: 'Shows what is planned, in progress and done.',
  changelog: 'Tells visitors what has shipped.',
  help: 'Articles visitors can search and read.',
  support: 'Visitors contact your team and follow their conversations.',
  status: 'Shows whether things are working, and any incidents.',
}

const MODULE_LIST = '/admin/settings/general'

/** The parts that are off, each with what it does and where it is turned on. */
export function offParts(gates: PortalPageGates, settings: PageGateSettings): OffPart[] {
  const flags = settings.featureFlags
  const href: Record<PortalPageType, string> = {
    feedback: MODULE_LIST,
    roadmap: MODULE_LIST,
    changelog: MODULE_LIST,
    help: MODULE_LIST,
    support: isProductEnabled(flags, 'support') ? '/admin/settings/support' : MODULE_LIST,
    // On but unpublished, or for signed-in visitors only: its own settings say.
    status: isProductEnabled(flags, 'status') ? '/admin/settings/status' : MODULE_LIST,
  }
  return PAGE_ORDER.filter((type) => !gates[type]).map((type) => ({
    type,
    name: PAGE_NAMES[type],
    does: DOES[type],
    href: href[type],
  }))
}

/**
 * The parts on now that were not on when the builder last opened here. The
 * first visit has nothing to compare, so nothing is new.
 */
export function newParts(
  seen: readonly PortalPageType[] | null,
  gates: PortalPageGates
): PortalPageType[] {
  if (!seen) return []
  return PAGE_ORDER.filter((type) => gates[type] && !seen.includes(type))
}

/** The parts that are on, to remember for the next visit. */
export function partsOnNow(gates: PortalPageGates): PortalPageType[] {
  return PAGE_ORDER.filter((type) => gates[type])
}
