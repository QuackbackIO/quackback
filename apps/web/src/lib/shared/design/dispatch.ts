/**
 * The operations that change a design's Home blocks and page parts, as one
 * vocabulary for people and for Quackback AI. The builder's panels dispatch
 * these instead of writing the draft, and the AI's operations (design-ops.ts)
 * resolve what the model names (a block by its name, a board by its name, a
 * value in words) and then dispatch the same ones. So a change is checked
 * and laid out the same way whoever makes it:
 *
 * - a setting goes through the block registry's applySetting, which checks
 *   it against what the block offers and the design's schema;
 * - an operation that changes which blocks Home holds, or their order, ends
 *   by settling Home (settleHome): in the grid, at least each block's least
 *   size, none overlapping, floated up;
 * - a move or resize on the grid, and a drop from Add, are laid out on the
 *   grid the page draws (editGrid, insertHomeBlockAt), which leaves a block
 *   the page does not draw where it is, so it is never settled over them.
 *
 * `applyDesignOp` changes the draft it is handed in place and returns what
 * the operation made, or a refusal saying plainly why not; a refused
 * operation leaves the draft as it was. `refusalOf` says before a change
 * whether one would be refused, so a refusal never becomes an empty step.
 */
import {
  applySetting,
  blockOf,
  sectionOf,
  writeSection,
  type SectionType,
  type SettingResult,
} from './blocks'
import {
  matchLook,
  resetLook,
  setHiddenOnPhones,
  writeLook,
  type LookProp,
  type LookScope,
} from './block-look'
import { editGrid, type GridChange } from './grid-edit'
import { setWordsDoc, type WordsField } from './headline-words'
import { heroOf, writeHero, type HeroKey } from './hero'
import {
  duplicateHomeBlock,
  insertHomeBlock,
  insertHomeBlockAt,
  moveHomeBlock,
  placeHomeBlock,
  settleHome,
  type HomeBlock,
  type HomeBlockType,
} from './home'
import type { GridPlace } from './home-grid'
import { setTitle } from './logo'
import {
  addMenuLink,
  isMenuLinkUrl,
  menuParts,
  moveMenuPart,
  removeMenuLink,
  renameMenuPart,
  setLanding,
  setMenuShown,
  type MenuPartId,
} from './menu'
import { readOverrideOp, writeOverride } from './override-ops'
import type { BundledFontId } from './fonts'
import { takeHomeLayout, type HomeLayout } from './home-layouts'
import type { Selection } from './outline'
import { PAGE_CHOICE_DEFAULTS, type PageChoices } from './page-choices'
import type { WordsDoc } from './rich-words'
import { setRowShown } from './page-tree'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'
import type { StyleElement } from './style-tokens'

/** A Home block, by its id or its place in the list of blocks. */
export type BlockRef = string | number

type ChoicePage = keyof PageChoices

export type DesignOp =
  /** One of a Home block's settings, through the registry's checks; words go in `locale`. */
  | { op: 'block.set'; block: BlockRef; key: string; value: unknown; locale?: string }
  /** Several of a block's settings as one change, in order; refused whole if one is. */
  | {
      op: 'block.setEach'
      block: BlockRef
      settings: Readonly<Record<string, unknown>>
      locale?: string
    }
  /**
   * A new block under the block with id `after`, at its column; without one,
   * under them all. With `turnOnHome`, Home is turned on too while it is off,
   * as Quick find's Turn on Home does, so the block is seen.
   */
  | {
      op: 'block.add'
      type: HomeBlockType
      after?: string | null
      turnOnHome?: { gates: PortalPageGates }
    }
  /**
   * A block dropped from Add at a cell of the grid the page draws. `from` is
   * Home's blocks as the drag began, laid out again before each drop is shown.
   */
  | {
      op: 'block.drop'
      block: HomeBlock
      at: Pick<GridPlace, 'x' | 'y'> | null
      gates: PortalPageGates
      from?: readonly HomeBlock[]
    }
  /** A copy of a block under it, with its own id; nothing while Home is full. */
  | { op: 'block.duplicate'; id: string }
  | { op: 'block.remove'; block: BlockRef }
  /** One place earlier or later in reading order. */
  | { op: 'block.step'; id: string; by: -1 | 1 }
  /** To a place in reading order, counted before it moves. */
  | { op: 'block.place'; id: string; place: number }
  /**
   * A move, nudge or resize on the grid the page draws. `from` is Home's
   * blocks as a drag began, which each step of the drag starts from; with
   * no change, the blocks go back to `from`.
   */
  | {
      op: 'block.grid'
      id: string
      change: GridChange | null
      gates: PortalPageGates
      from?: readonly HomeBlock[]
    }
  /** A look field on this block, or on every block that takes a look; undefined clears it. */
  | { op: 'block.look'; id: string; scope: LookScope; prop: LookProp; value: string | undefined }
  /** A look field back to the other blocks' value (just this one) or to its usual one (every block). */
  | { op: 'block.lookReset'; id: string; scope: LookScope; prop: LookProp }
  /** Gives the block `id` the look fields of the block `to`. */
  | { op: 'block.matchLook'; id: string; to: string }
  /** Takes away a block's own look of one element it draws. */
  | { op: 'block.styleReset'; id: string; element: StyleElement }
  /** Leaves a Home block off phones, or shows it there again (`look.phone.hidden`). */
  | { op: 'block.phoneHidden'; id: string; hidden: boolean }
  /** Arranges Home's blocks as a layout to start from. */
  | { op: 'home.layout'; layout: HomeLayout; gates: PortalPageGates }
  /** One of a page section's settings, through the registry's checks. */
  | { op: 'section.set'; type: SectionType; key: string; value: unknown; locale?: string }
  /** One of a page's choices; today's look is no choice, so it is left out. */
  | { op: 'page.choice'; page: ChoicePage; key: string; value: unknown }
  /** Shows or hides a part of a page, as its row in the page's list of parts does. */
  | { op: 'part.shown'; key: Selection; shown: boolean }
  /** Words typed where they sit on the page: a block's, a page's or the hero's, in one language. */
  | { op: 'words.set'; field: WordsField; locale: string; doc: WordsDoc }
  /** One of the hero's settings, through the registry's checks; its looks reach every page. */
  | { op: 'hero.set'; key: string; value: unknown; locale?: string }
  /** A brand colour by its role, in light or dark mode; null takes it away (dark: worked out again). */
  | { op: 'brand.colour'; role: BrandColourRole; value: string | null; mode?: 'light' | 'dark' }
  /** The heading or body face, one of the bundled fonts. */
  | { op: 'brand.font'; slot: 'heading' | 'body'; font: BundledFontId }
  /** The title beside the logo's icon; empty goes back to the workspace's name. */
  | { op: 'logo.title'; title: string }
  /**
   * One element's look in a state: everywhere, or for a part, a page or a
   * Home block (`scope` part:<id>, page:<page>, block:<id>); on all screens,
   * phones or dark mode. Undefined or null clears it.
   */
  | {
      op: 'style.set'
      element: string
      state?: string
      prop: string
      value: unknown
      scope?: string
      layer?: 'all' | 'phone' | 'dark'
    }
  /** A menu item (home, a page type, or link:<id>) renamed; empty gives it back its own name. */
  | { op: 'menu.rename'; item: string; name: string; gates: PortalPageGates }
  | { op: 'menu.shown'; item: string; shown: boolean; gates: PortalPageGates }
  /** To a place among the items that move (all but Home), as the menu reads now. */
  | { op: 'menu.move'; item: string; place: number; gates: PortalPageGates }
  | { op: 'menu.addLink'; label: string; url: string }
  | { op: 'menu.removeLink'; item: string }

/** The roles of the brand's colours an operation can set. */
export const BRAND_COLOUR_ROLES = [
  'accent',
  'background',
  'ink',
  'surface',
  'raised',
  'muted',
  'border',
  'support',
] as const
export type BrandColourRole = (typeof BRAND_COLOUR_ROLES)[number]
/** Every brand has these in light mode; the rest are worked out when missing. */
const REQUIRED_ROLES: ReadonlySet<BrandColourRole> = new Set(['accent', 'background', 'ink'])

export type DesignOpKind = DesignOp['op']

/** What an operation made, or why not. */
export type DispatchResult =
  | {
      ok: true
      /** The block added or copied; absent when none was. */
      block?: HomeBlock
      /** Where a block moved, resized or dropped landed; null when it did not move. */
      place?: GridPlace | null
      /** After a removal, the block that now sits where it was, else the one before. */
      near?: HomeBlock | null
    }
  | { ok: false; refusal: string }

/** The operations after which Home is settled: they change which blocks it holds, or their order. */
export const SETTLES: ReadonlySet<DesignOpKind> = new Set([
  'block.add',
  'block.duplicate',
  'block.remove',
  'block.step',
  'block.place',
])

const refuse = (refusal: string): DispatchResult => ({ ok: false, refusal })
const GONE = 'That block is no longer on Home'

function indexOf(design: PortalDesign, ref: BlockRef): number {
  const blocks = design.pages.home.blocks
  if (typeof ref === 'number') return ref >= 0 && ref < blocks.length ? ref : -1
  return blocks.findIndex((block) => block.id === ref)
}

/** A change named for the block and its setting, such as "Top posts: How many". */
export function settingLabel(type: string, key: string): string {
  const def = blockOf(type)
  const field = def?.fields.find((each) => each.key === key)
  return def ? `${def.name}${field ? `: ${field.label}` : ''}` : 'Block'
}

/**
 * Why the operation would be refused on this design, or null. Only a
 * setting can be refused; the rest always apply, or change nothing.
 */
export function refusalOf(design: PortalDesign, op: DesignOp): string | null {
  switch (op.op) {
    case 'block.set':
    case 'block.setEach': {
      const block = design.pages.home.blocks[indexOf(design, op.block)]
      if (!block) return GONE
      const next = settingsOn(block, op)
      return next.ok ? null : next.refusal
    }
    case 'section.set': {
      const next = applySetting(sectionOf(design, op.type), op.key, op.value, op.locale)
      return next.ok ? null : next.refusal
    }
    case 'hero.set': {
      const next = applySetting(heroOf(design), op.key, op.value, op.locale)
      return next.ok ? null : next.refusal
    }
    case 'brand.colour':
      return op.value === null && (op.mode ?? 'light') === 'light' && REQUIRED_ROLES.has(op.role)
        ? `The brand always has a ${op.role} colour; set another instead`
        : null
    case 'style.set': {
      const read = readStyle(design, op)
      return read.ok ? null : read.refusal
    }
    case 'menu.rename':
    case 'menu.shown':
    case 'menu.move':
    case 'menu.removeLink':
      return menuItemRefusal(design, op)
    case 'menu.addLink':
      if (!op.label.trim()) return 'A link needs a name'
      return isMenuLinkUrl(op.url) ? null : 'A link’s address starts with http:// or https://'
    default:
      return null
  }
}

const LAYER_PREFIX = { all: '', phone: 'phone.', dark: 'dark.' } as const

function readStyle(design: PortalDesign, op: Extract<DesignOp, { op: 'style.set' }>) {
  const key = `${LAYER_PREFIX[op.layer ?? 'all']}${op.element}.${op.state ?? 'base'}.${op.prop}`
  return readOverrideOp(design, op.scope ?? 'everywhere', key, op.value ?? null)
}

/** Why a menu operation names no item it can change, or null. */
function menuItemRefusal(
  design: PortalDesign,
  op: Extract<DesignOp, { op: 'menu.rename' | 'menu.shown' | 'menu.move' | 'menu.removeLink' }>
): string | null {
  if (op.op === 'menu.removeLink') {
    return design.nav.items.some((i) => i.type === 'link' && `link:${i.id}` === op.item)
      ? null
      : `There is no link ${op.item} in the menu`
  }
  if (!menuParts(design, op.gates).some((part) => part.id === op.item))
    return `There is no ${op.item} in the menu`
  if (op.op === 'menu.move' && op.item === 'home') return 'Home stays first in the menu'
  if (op.op === 'menu.shown' && op.item.startsWith('link:'))
    return 'A link is in the menu or not: remove it instead'
  return null
}

/** The block with the operation's settings made, each checked in turn, or the first refusal. */
function settingsOn(
  block: HomeBlock,
  op: Extract<DesignOp, { op: 'block.set' | 'block.setEach' }>
): SettingResult<HomeBlock> {
  const settings = op.op === 'block.set' ? { [op.key]: op.value } : op.settings
  let made: SettingResult<HomeBlock> = { ok: true, block }
  for (const [key, value] of Object.entries(settings)) {
    if (!made.ok) break
    made = applySetting(made.block, key, value, op.locale)
  }
  return made
}

/** Makes one operation on the draft, in place; a refused one leaves it as it was. */
export function applyDesignOp(draft: PortalDesign, op: DesignOp): DispatchResult {
  const refusal = OWN_CHECKS.has(op.op) ? refusalOf(draft, op) : null
  if (refusal) return refuse(refusal)
  const result = run(draft, op)
  if (result.ok && SETTLES.has(op.op)) settleHome(draft)
  return result
}

/** The operations whose refusals are checked before they run, since writing them cannot refuse. */
const OWN_CHECKS: ReadonlySet<DesignOpKind> = new Set([
  'brand.colour',
  'style.set',
  'menu.rename',
  'menu.shown',
  'menu.move',
  'menu.addLink',
  'menu.removeLink',
])

function run(draft: PortalDesign, op: DesignOp): DispatchResult {
  const blocks = draft.pages.home.blocks
  switch (op.op) {
    case 'block.set':
    case 'block.setEach': {
      const at = indexOf(draft, op.block)
      const block = blocks[at]
      if (!block) return refuse(GONE)
      const next = settingsOn(block, op)
      if (!next.ok) return next
      blocks[at] = next.block
      return { ok: true }
    }
    case 'block.add': {
      const block = insertHomeBlock(draft, op.type, op.after)
      // With the block in, Home is turned on as it is, never filled with starters.
      if (op.turnOnHome && !draft.nav.home.on) setLanding(draft, op.turnOnHome.gates, 'home')
      return { ok: true, block }
    }
    case 'block.drop': {
      if (op.from) draft.pages.home.blocks = structuredClone(op.from) as HomeBlock[]
      const place = op.at
        ? insertHomeBlockAt(draft, op.gates, structuredClone(op.block), op.at)
        : null
      return { ok: true, place }
    }
    case 'block.duplicate':
      return { ok: true, block: duplicateHomeBlock(draft, op.id) ?? undefined }
    case 'block.remove': {
      const at = indexOf(draft, op.block)
      if (at < 0) return refuse(GONE)
      const kept = blocks.filter((_, i) => i !== at)
      draft.pages.home.blocks = kept
      return { ok: true, near: kept[at] ?? kept[at - 1] ?? null }
    }
    case 'block.step':
      moveHomeBlock(draft, op.id, op.by)
      return { ok: true }
    case 'block.place':
      placeHomeBlock(draft, op.id, op.place)
      return { ok: true }
    case 'block.grid': {
      if (op.from) draft.pages.home.blocks = structuredClone(op.from) as HomeBlock[]
      const place = op.change ? editGrid(draft, op.gates, op.id, op.change) : null
      return { ok: true, place }
    }
    case 'block.look':
      writeLook(draft, op.scope, op.id, op.prop, op.value)
      return { ok: true }
    case 'block.lookReset':
      resetLook(draft, op.scope, op.id, op.prop)
      return { ok: true }
    case 'block.matchLook':
      matchLook(draft, op.id, op.to)
      return { ok: true }
    case 'block.styleReset': {
      const sheet = blocks.find((block) => block.id === op.id)?.look?.style as
        Record<string, unknown> | undefined
      if (sheet) delete sheet[op.element]
      return { ok: true }
    }
    case 'block.phoneHidden':
      setHiddenOnPhones(draft, op.id, op.hidden)
      return { ok: true }
    case 'home.layout':
      takeHomeLayout(draft, op.layout, op.gates)
      return { ok: true }
    case 'section.set': {
      const next = applySetting(sectionOf(draft, op.type), op.key, op.value, op.locale)
      if (!next.ok) return next
      writeSection(draft, next.block)
      return { ok: true }
    }
    case 'page.choice': {
      const pages = draft.pages as Record<string, unknown>
      const made = { ...(pages[op.page] as Record<string, unknown> | undefined) }
      const usual = (PAGE_CHOICE_DEFAULTS[op.page] as Record<string, unknown>)[op.key]
      if (op.value === usual) delete made[op.key]
      else made[op.key] = op.value
      if (Object.keys(made).length) pages[op.page] = made
      else delete pages[op.page]
      return { ok: true }
    }
    case 'part.shown':
      setRowShown(draft, op.key, op.shown)
      return { ok: true }
    case 'words.set':
      setWordsDoc(draft, op.field, op.locale, op.doc)
      return { ok: true }
    case 'hero.set': {
      const next = applySetting(heroOf(draft), op.key, op.value, op.locale)
      if (!next.ok) return next
      writeHero(draft, next.block, op.key as HeroKey)
      return { ok: true }
    }
    case 'brand.colour': {
      const mode = op.mode ?? 'light'
      const palette = (mode === 'light' ? draft.brand.light : (draft.brand.dark ??= {})) as Record<
        string,
        string | undefined
      >
      if (op.value === null) delete palette[op.role]
      else palette[op.role] = op.value
      if (mode === 'dark' && !Object.keys(palette).length) delete draft.brand.dark
      return { ok: true }
    }
    case 'brand.font':
      draft.brand.fonts[op.slot] = { kind: 'bundled', id: op.font }
      return { ok: true }
    case 'logo.title':
      setTitle(draft, op.title)
      return { ok: true }
    case 'style.set': {
      const read = readStyle(draft, op)
      if (!read.ok) return read
      writeOverride(draft, read.read)
      return { ok: true }
    }
    case 'menu.rename':
      renameMenuPart(draft, op.item as MenuPartId, op.name)
      return { ok: true }
    case 'menu.shown':
      return setMenuShown(draft, op.gates, op.item as MenuPartId, op.shown)
        ? { ok: true }
        : refuse('Visitors land on this page while Home is off, so it stays in the menu')
    case 'menu.move':
      moveMenuPart(draft, op.gates, op.item as MenuPartId, op.place)
      return { ok: true }
    case 'menu.addLink':
      addMenuLink(draft, { label: op.label, url: op.url })
      return { ok: true }
    case 'menu.removeLink':
      removeMenuLink(draft, op.item as MenuPartId)
      return { ok: true }
  }
}
