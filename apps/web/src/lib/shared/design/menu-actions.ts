/**
 * The portal's menu, edited on the page: what a click on a menu item offers,
 * where Go to goes, and each change as a step named for undo. Every change is
 * one of the menu's own operations (menu.ts) applied to the draft.
 */
import {
  addMenuLink,
  landingOf,
  linkOf,
  menuParts,
  moveMenuPart,
  removeMenuLink,
  renameMenuPart,
  setLanding,
  setMenuShown,
  type MenuPart,
  type MenuPartId,
} from './menu'
import { MENU_WORDS as WORDS } from './menu-words'
import { PAGE_NAMES, type DesignerPage } from './outline'
import { PAGE_PATHS, type PortalPageGates, type PortalPageType } from './paths'
import type { PortalDesign } from './schema'

/** What the frame says a click or the pointer is on: a menu item, the logo or sign in. */
export type MenuTarget = MenuPartId | 'logo' | 'sign-in'

/** Whether a value from the frame names a menu item, the logo or sign in. */
export function isMenuTarget(value: unknown): value is MenuTarget {
  if (typeof value !== 'string') return false
  if (value === 'home' || value === 'logo' || value === 'sign-in') return true
  if (/^link:[\w-]{1,64}$/.test(value)) return true
  return Object.hasOwn(PAGE_PATHS, value)
}

/** What a click menu entry does. */
export type MenuAction =
  'go' | 'rename' | 'land' | 'hide' | 'left' | 'right' | 'edit-link' | 'remove' | 'sign-in-settings'

export interface ClickMenuEntry {
  action: MenuAction
  label: string
  /** A quiet word at the end: its key, or what it leaves as it is. */
  hint?: string
  disabled?: boolean
}

export interface ClickMenu {
  /** A line over the entries saying what the item is, when its name does not. */
  title: string | null
  entries: ClickMenuEntry[]
}

/** The copy the menu's controls use, in one place; the words they share are the panels' own. */
export const MENU_COPY = {
  rename: WORDS.rename,
  renameHint: 'Double-click',
  land: WORDS.makeLanding,
  hide: WORDS.hide,
  landsHere: WORDS.landingPage,
  left: WORDS.moveLeft,
  right: WORDS.moveRight,
  editLink: 'Edit link',
  remove: WORDS.remove,
  signInTitle: 'Visitors sign in here',
  signInSettings: 'Sign-in settings',
  enter: 'Enter',
  renameKeys: { save: 'to save', cancel: 'to cancel' },
  add: WORDS.addToMenu,
  addLink: WORDS.link,
  coachHint: 'Pick an item to rename or move it.',
  coachDone: 'Got it',
} as const

/** The header panel's words. */
export const HEADER_COPY = {
  title: 'Header and menu',
  logo: 'Logo',
  logoAction: 'Change the logo in Theme',
  menu: 'Menu',
  hidden: WORDS.hidden,
  show: WORDS.show,
  add: WORDS.addToMenu,
  land: WORDS.landingPage,
  landHelp: 'Where visitors and the logo go',
  layout: 'Layout',
  menuStyle: 'Menu style',
} as const

/** Where sign in is set up. */
export const SIGN_IN_SETTINGS = '/admin/settings/portal'

/** What each page is, said plainly, for the line over its click menu. */
const KINDS: Record<'home' | PortalPageType, string> = {
  home: 'home page',
  feedback: 'feedback',
  roadmap: 'roadmap',
  changelog: 'changelog',
  help: 'help center',
  support: 'support',
  status: 'status page',
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function titleOf(part: MenuPart): string | null {
  if (part.kind === 'link') return `A link to ${hostOf(part.href)}`
  if (!part.adminName) return null
  return `Your ${KINDS[part.id as 'home' | PortalPageType]}, called "${part.label}" in your menu`
}

/** The parts that can move: every part but Home. */
const movable = (parts: MenuPart[]) => parts.filter((part) => part.kind !== 'home')

/** Whether hiding a part would move where visitors land, so it stays. */
const staysShown = (design: PortalDesign, part: MenuPart) =>
  part.kind === 'page' && part.lands && !design.nav.home.on

/** What a click on a menu item, the logo or sign in offers, first entry the default. */
export function clickMenu(
  design: PortalDesign,
  gates: PortalPageGates,
  target: MenuTarget
): ClickMenu | null {
  const parts = menuParts(design, gates)
  if (target === 'logo') {
    const landing = parts.find((part) => part.id === landingOf(design, gates))
    const name = landing?.label ?? PAGE_NAMES[landingOf(design, gates)]
    return {
      title: null,
      entries: [{ action: 'go', label: `Go to ${name}`, hint: MENU_COPY.enter }],
    }
  }
  if (target === 'sign-in')
    return {
      title: MENU_COPY.signInTitle,
      entries: [{ action: 'sign-in-settings', label: MENU_COPY.signInSettings }],
    }
  const part = parts.find((each) => each.id === target)
  if (!part) return null
  const places = movable(parts)
  const at = places.findIndex((each) => each.id === part.id)
  const moves: ClickMenuEntry[] =
    part.kind === 'home'
      ? []
      : [
          { action: 'left', label: MENU_COPY.left, ...(at <= 0 ? { disabled: true } : {}) },
          {
            action: 'right',
            label: MENU_COPY.right,
            ...(at >= places.length - 1 ? { disabled: true } : {}),
          },
        ]
  const rename: ClickMenuEntry = {
    action: 'rename',
    label: MENU_COPY.rename,
    hint: MENU_COPY.renameHint,
  }
  if (part.kind === 'link')
    return {
      title: titleOf(part),
      entries: [
        { action: 'edit-link', label: MENU_COPY.editLink },
        rename,
        ...moves,
        { action: 'remove', label: MENU_COPY.remove },
      ],
    }
  const stays = staysShown(design, part)
  return {
    title: titleOf(part),
    entries: [
      { action: 'go', label: `Go to ${part.label}`, hint: MENU_COPY.enter },
      rename,
      ...(part.lands ? [] : [{ action: 'land', label: MENU_COPY.land } as const]),
      stays
        ? { action: 'hide', label: MENU_COPY.hide, hint: MENU_COPY.landsHere, disabled: true }
        : { action: 'hide', label: MENU_COPY.hide },
      ...moves,
    ],
  }
}

/** The page Go to shows: the item's own, or for the logo where visitors land. Null for a link or sign in. */
export function goTarget(
  design: PortalDesign,
  gates: PortalPageGates,
  target: MenuTarget
): DesignerPage | null {
  if (target === 'logo') return landingOf(design, gates)
  if (target === 'sign-in' || target.startsWith('link:')) return null
  return target as DesignerPage
}

/** A change to the draft and what undo calls it. */
export interface MenuStep {
  label: string
  change: (draft: PortalDesign) => void
  /** What a screen reader hears once it is made, when more than its label. */
  said?: string
}

/** What is said once a part moves, counting places from one among the parts that can move. */
const movedWords = (name: string, place: number, count: number) =>
  `${name} moved to place ${place + 1} of ${count} in the menu.`

/** The menu changes a step can make; up and down are left and right, as a list reads them. */
export type MenuStepKind = 'land' | 'hide' | 'show' | 'left' | 'right' | 'up' | 'down' | 'remove'

/** A menu change as a step, or null when it cannot be made, such as moving past an end. */
export function menuStep(
  design: PortalDesign,
  gates: PortalPageGates,
  id: MenuPartId,
  kind: MenuStepKind
): MenuStep | null {
  const parts = menuParts(design, gates)
  const part = parts.find((each) => each.id === id)
  if (!part) return null
  const name = part.label
  switch (kind) {
    case 'land':
      if (part.kind !== 'page' || part.lands) return null
      return {
        label: `${name} as the landing page`,
        change: (draft) => setLanding(draft, gates, id as PortalPageType),
      }
    case 'hide':
    case 'show': {
      const shown = kind === 'show'
      if (part.kind === 'link' || part.shown === shown) return null
      if (!shown && staysShown(design, part)) return null
      return {
        label: `${shown ? WORDS.show : WORDS.hide} ${name}`,
        change: (draft) => void setMenuShown(draft, gates, id, shown),
      }
    }
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      const places = movable(parts)
      const at = places.findIndex((each) => each.id === id)
      const to = at + (kind === 'left' || kind === 'up' ? -1 : 1)
      if (at < 0 || to < 0 || to >= places.length) return null
      return {
        label: `Move ${name} ${kind}`,
        change: (draft) => moveMenuPart(draft, gates, id, to),
        said: movedWords(name, to, places.length),
      }
    }
    case 'remove':
      if (part.kind !== 'link') return null
      return { label: `Remove the ${name} link`, change: (draft) => removeMenuLink(draft, id) }
  }
}

/** Lands visitors on Home, which turns it on, or on a page; null where they land already. */
export function landingStep(
  design: PortalDesign,
  gates: PortalPageGates,
  target: 'home' | PortalPageType
): MenuStep | null {
  if (landingOf(design, gates) === target) return null
  if (target !== 'home') return menuStep(design, gates, target, 'land')
  return {
    label: `${design.nav.home.label ?? 'Home'} as the landing page`,
    change: (draft) => setLanding(draft, gates, 'home'),
  }
}

/** Adds a link to the end of the menu, named for it. */
export function addLinkStep(link: { label: string; url: string }): MenuStep {
  return {
    label: `Add the ${link.label.trim()} link`,
    change: (draft) => void addMenuLink(draft, link),
  }
}

/** The longest name the menu keeps. */
export const MENU_NAME_MAX = 40

/** A page's or Home's own name, which an empty name gives back. */
function ownName(part: MenuPart): string | null {
  if (part.kind === 'link') return null
  return part.kind === 'home' ? 'Home' : PAGE_NAMES[part.id as PortalPageType]
}

/**
 * Renames an item in place. An empty name gives Home or a page back its own
 * and leaves a link as it was; the same name changes nothing (null).
 */
export function renameStep(
  design: PortalDesign,
  gates: PortalPageGates,
  id: MenuPartId,
  text: string
): MenuStep | null {
  const part = menuParts(design, gates).find((each) => each.id === id)
  if (!part) return null
  const typed = text.trim().slice(0, MENU_NAME_MAX)
  const own = ownName(part)
  const next = typed || own
  if (!next || next === part.label) return null
  if (part.kind === 'link' && !linkOf(design, id)) return null
  return {
    label: `Rename ${part.label} to ${next}`,
    change: (draft) => renameMenuPart(draft, id, next === own ? '' : next),
  }
}

/** A menu item's box along the row, as the drag reads it. */
export interface MenuItemBox {
  left: number
  width: number
}

/**
 * The gap a dragged menu item is over, from the pointer's x: before the
 * first item whose middle is right of it, else after the last (the number
 * of items).
 */
export function menuDropGap(boxes: readonly MenuItemBox[], x: number): number {
  const at = boxes.findIndex((box) => x < box.left + box.width / 2)
  return at < 0 ? boxes.length : at
}

/** Where the insertion bar for a gap is drawn: halfway between two items, or at an outer edge. */
export function menuDropBar(boxes: readonly MenuItemBox[], gap: number): number {
  const before = boxes[gap - 1]
  const after = boxes[gap]
  if (!before) return after?.left ?? 0
  const end = before.left + before.width
  return after ? (end + after.left) / 2 : end
}

/**
 * The place a drop in a gap among the drawn items puts the dragged one,
 * counted among every part that can move with it taken out, as
 * `moveMenuPart` reads it; a hidden part the menu does not draw keeps its
 * place. Null in the gaps either side of the item itself.
 */
export function menuDropPlace(
  movable: readonly MenuPartId[],
  drawn: readonly MenuPartId[],
  dragged: MenuPartId,
  gap: number
): number | null {
  if (drawn[gap] === dragged || drawn[gap - 1] === dragged) return null
  const rest = movable.filter((id) => id !== dragged)
  const anchor = drawn[gap]
  if (anchor) return rest.indexOf(anchor)
  const last = drawn.at(-1)
  return last ? rest.indexOf(last) + 1 : null
}

/** A dragged part dropped at a place, as one step; null for Home or where it already is. */
export function menuPlaceStep(
  design: PortalDesign,
  gates: PortalPageGates,
  id: MenuPartId,
  place: number
): MenuStep | null {
  const places = movable(menuParts(design, gates))
  const at = places.findIndex((part) => part.id === id)
  const to = Math.max(0, Math.min(place, places.length - 1))
  if (at < 0 || to === at) return null
  const name = places[at]!.label
  return {
    label: `Move ${name} in the menu`,
    change: (draft) => moveMenuPart(draft, gates, id, to),
    said: movedWords(name, to, places.length),
  }
}

/** The ids of the parts that can move, in the menu's order. */
export const movableParts = (design: PortalDesign, gates: PortalPageGates): MenuPartId[] =>
  movable(menuParts(design, gates)).map((part) => part.id)
