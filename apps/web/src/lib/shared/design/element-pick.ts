/**
 * Picking an element on the canvas: what is under the pointer, as the
 * builder names it. The innermost addressable element wins: a registered
 * part ("this one"), else an element kind the style registry knows (styled
 * for its page or everywhere). A block's own box is the block, not an
 * element in it.
 *
 * A pick is kept as what it is (its kind, its part, its block) and which of
 * that kind's elements in the block it was, so it is found again when the
 * page draws afresh.
 */
import { DATA_MARKS, ELEMENT_KINDS, type ContentKind } from './content-kinds'
import { partSelector, partsOnPage, type PartInfo } from './parts-registry'
import type { PortalDesign } from './schema'
import type { OverridePage } from './style-overrides'
import { STYLE_ELEMENTS, type StyleElement, type StyleProp } from './style-tokens'

export interface ElementPick {
  element: StyleElement
  /** The registered part it is, or null for repeated content. */
  part: string | null
  /** The block or section it is in, as the outline keys it. */
  section: string | null
  /** Which of the matching elements in its section (or the page) it is. */
  index: number
}

/**
 * The element kinds a click can land on, most specific first; the page's
 * large regions (the header, the hero, the footer, a block) are blocks.
 */
export const PICKABLE: readonly StyleElement[] = [
  'vote',
  'navItem',
  'tab',
  'button',
  'secondary',
  'ghost',
  'link',
  'chip',
  'badge',
  'input',
  'headline',
  'subtitle',
  'heading',
  'image',
  'divider',
  'body',
  'postCard',
  'panel',
]

const sectionNode = (node: Element) => node.closest('[data-qb-section]')

/** Where a pick's elements are, under its section (or the page). */
function selectorOf(pick: Pick<ElementPick, 'element' | 'part'>, parts: readonly PartInfo[]) {
  const part = pick.part ? parts.find((p) => p.id === pick.part) : null
  return part ? partSelector(part, pick.element) : STYLE_ELEMENTS[pick.element].selector
}

function scopeOf(doc: Document | Element, section: string | null): ParentNode | null {
  if (!section) return doc
  const owner = 'ownerDocument' in doc && doc.ownerDocument ? doc.ownerDocument : (doc as Document)
  for (const node of owner.querySelectorAll('[data-qb-section]'))
    if (node.getAttribute('data-qb-section') === section) return node
  return null
}

/**
 * The elements a selector names in a section (or the page), read from the
 * whole page, since a selector can name what the section sits in.
 */
function within(doc: Document, section: string | null, selector: string): Element[] {
  const scope = scopeOf(doc, section)
  if (!scope) return []
  try {
    return [...doc.querySelectorAll(selector)].filter(
      (node) => node !== scope && scope.contains(node)
    )
  } catch {
    return []
  }
}

const matches = (node: Element, selector: string) => {
  try {
    return node.matches(selector)
  } catch {
    return false
  }
}

/** Who owns what a node says: its part's kind, else its data marks', else its element kind's. */
function kindOf(
  node: Element,
  found: Pick<ElementPick, 'element' | 'part'>,
  parts: readonly PartInfo[]
): ContentKind {
  const part = found.part ? parts.find((p) => p.id === found.part) : null
  if (part) return part.kind
  if (matches(node, DATA_MARKS)) return 'dynamic'
  return ELEMENT_KINDS[found.element]
}

/** What a node is, by itself: a part, else an element kind; null for neither. */
function identify(
  node: Element,
  parts: readonly PartInfo[]
): Pick<ElementPick, 'element' | 'part'> | null {
  for (const part of parts)
    for (const element of part.elements)
      if (matches(node, partSelector(part, element))) return { element, part: part.id }
  for (const element of PICKABLE)
    if (matches(node, STYLE_ELEMENTS[element].selector)) return { element, part: null }
  return null
}

/**
 * The element a pointer at `target` picks, and its node: the innermost
 * addressable element from it up to its block; null on a block's own box.
 */
export function pickAt(
  target: Element | null,
  design: PortalDesign,
  page: OverridePage | null
): { pick: ElementPick; node: Element } | null {
  if (!target || target.closest('[data-qb-words-editing]')) return null
  const parts = page ? partsOnPage(design, page) : []
  const section = sectionNode(target)
  // What a builder-only sample shows is made up: it is never picked as data.
  const sample = !!section?.querySelector('[data-qb-sample]')
  for (let node: Element | null = target; node && node !== section; node = node.parentElement) {
    const found = identify(node, parts)
    if (!found) continue
    if (sample && kindOf(node, found, parts) === 'dynamic') continue
    const key = section?.getAttribute('data-qb-section') ?? null
    const all = within(target.ownerDocument, key, selectorOf(found, parts))
    return { pick: { ...found, section: key, index: Math.max(0, all.indexOf(node)) }, node }
  }
  return null
}

/** A pick's node on the page as it is drawn now, if it is still there. */
export function locatePick(
  doc: Document,
  pick: ElementPick,
  design: PortalDesign,
  page: OverridePage | null
): Element | null {
  const parts = page ? partsOnPage(design, page) : []
  const all = within(doc, pick.section, selectorOf(pick, parts))
  return all[pick.index] ?? all[0] ?? null
}

/** Every element a block (or section) holds that can be picked, in reading order. */
export function picksIn(
  doc: Document,
  section: string,
  design: PortalDesign,
  page: OverridePage | null
): ElementPick[] {
  const scope = scopeOf(doc, section)
  if (!scope) return []
  const parts = page ? partsOnPage(design, page) : []
  const out: ElementPick[] = []
  const seen = new Set<string>()
  for (const node of scope.querySelectorAll('*')) {
    // Not shown, such as the menu's copy for another width.
    if (node.closest('[hidden], [aria-hidden=true]')) continue
    const found = identify(node, parts)
    if (!found) continue
    const pick = pickAt(node, design, page)?.pick
    if (!pick || pick.section !== section) continue
    const key = pickKey(pick)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(pick)
  }
  return out
}

/** How many elements a change reaches, as the page drawn now can count them. */
export interface Reach {
  /** The elements of the pick's kind shown on this page. */
  page: number
  /** Those in the pick's Home block; null outside one. */
  block: number | null
}

/**
 * How many of a pick's kind the page shows, and its Home block. Only the
 * page drawn now can be counted: other pages are not drawn, so a site-wide
 * count is not known.
 */
export function reachOf(doc: Document, pick: Pick<ElementPick, 'element' | 'section'>): Reach {
  const selector = STYLE_ELEMENTS[pick.element].selector
  const shown = (root: ParentNode | null) => {
    if (!root) return 0
    let n = 0
    for (const node of root.querySelectorAll(selector))
      if (!node.closest('[hidden], [aria-hidden=true]')) n++
    return n
  }
  const inBlock = pick.section?.startsWith('block-') ? scopeOf(doc, pick.section) : null
  return { page: shown(doc), block: inBlock ? shown(inBlock) : null }
}

/** The computed style each number property is read from. */
const MEASURED: Partial<Record<StyleProp, keyof CSSStyleDeclaration>> = {
  radius: 'borderTopLeftRadius',
  size: 'fontSize',
  weight: 'fontWeight',
  borderWidth: 'borderTopWidth',
  paddingX: 'paddingLeft',
  paddingY: 'paddingTop',
  height: 'height',
  opacity: 'opacity',
  tracking: 'letterSpacing',
  leading: 'lineHeight',
}

/**
 * A number an element is drawn with, as its property says it (letter
 * spacing and line height relative to its size), for a field to show what
 * it has where nothing sets it. Undefined where it is not a number.
 */
export function measuredValue(node: Element, prop: StyleProp): number | undefined {
  const key = MEASURED[prop]
  const view = node.ownerDocument.defaultView
  if (!key || !view) return undefined
  const style = view.getComputedStyle(node)
  const raw = String(style[key] ?? '')
  const size = parseFloat(style.fontSize)
  if (prop === 'tracking' && (raw === 'normal' || raw === '')) return 0
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return undefined
  if (prop === 'tracking') return size ? +(n / size).toFixed(3) : undefined
  if (prop === 'leading')
    return raw.endsWith('px') ? (size ? +(n / size).toFixed(2) : undefined) : n
  return +n.toFixed(2)
}

/** A pick as one string, for the canvas's boxes and for comparing picks. */
export function pickKey(pick: ElementPick): string {
  return `el:${pick.section ?? ''}|${pick.element}|${pick.part ?? ''}|${pick.index}`
}

/** A pick read back from its key. */
export function pickOfKey(key: string): ElementPick | null {
  const m = /^el:([^|]*)\|(\w+)\|([^|]*)\|(\d+)$/.exec(key)
  if (!m || !(m[2]! in STYLE_ELEMENTS)) return null
  return {
    section: m[1] || null,
    element: m[2] as StyleElement,
    part: m[3] || null,
    index: Number(m[4]),
  }
}

/** What a pick is called on the canvas: "Call to action · Hero", "Main buttons". */
export function pickName(
  pick: ElementPick,
  design: PortalDesign,
  page: OverridePage | null
): string {
  const part = partOfPick(pick, design, page)
  if (part) return `${part.label} · ${part.group.replace(/ · .*$/, '')}`
  return singular(pick.element)
}

/** What a pick is called on its own, where its section is said beside it: "Call to action". */
export function pickLabel(
  pick: Pick<ElementPick, 'element' | 'part'>,
  design: PortalDesign,
  page: OverridePage | null
): string {
  return partOfPick(pick, design, page)?.label ?? singular(pick.element)
}

function partOfPick(
  pick: Pick<ElementPick, 'part'>,
  design: PortalDesign,
  page: OverridePage | null
) {
  return pick.part && page ? partsOnPage(design, page).find((p) => p.id === pick.part) : null
}

/** One of each element kind, as the canvas names it. */
const ONE: Record<StyleElement, string> = {
  button: 'Main button',
  secondary: 'Secondary button',
  ghost: 'Quiet button',
  link: 'Link',
  navItem: 'Menu item',
  tab: 'Tab',
  postCard: 'Post card',
  panel: 'Panel',
  block: 'Home block',
  input: 'Field',
  badge: 'Status marker',
  chip: 'Tag',
  vote: 'Vote box',
  headline: 'Headline',
  subtitle: 'Subtitle',
  heading: 'Section heading',
  body: 'Body text',
  hero: 'Hero',
  header: 'Header',
  footer: 'Footer',
  divider: 'Divider',
  image: 'Image',
}

/** An element kind's name for one of them: "Main button". */
export function singular(element: StyleElement): string {
  return ONE[element]
}

/** What the canvas says of a pick, beyond its name. */
export interface PickTraits {
  /** Who owns what it says. */
  kind: ContentKind
  /** How many elements styling it styles in its block: every item, for a data block's items. */
  count: number
  /** Which of those are the others, by their index. */
  others: number[]
  /** Whether it is words the design stores, which a double-click edits where they sit. */
  editable: boolean
  /** The portal path of the link it is or is in, if any. */
  link: string | null
}

/**
 * The portal path a link goes to, for the builder's Open; null for none, or
 * for a link off the portal, to the admin or the API.
 */
export function portalLinkOf(node: Element): string | null {
  const link = node.closest('a[href]')
  if (!link) return null
  try {
    const here = new URL(node.ownerDocument.baseURI)
    const url = new URL(link.getAttribute('href') ?? '', here)
    if (url.origin !== here.origin || /^\/(admin|api)(\/|$)/.test(url.pathname)) return null
    return url.pathname
  } catch {
    return null
  }
}

/** A pick's kind of content, how many it styles, and where it goes, from the page as it is drawn. */
export function pickTraits(
  doc: Document,
  pick: ElementPick,
  design: PortalDesign,
  page: OverridePage | null
): PickTraits | null {
  const parts = page ? partsOnPage(design, page) : []
  const all = within(doc, pick.section, selectorOf(pick, parts))
  const node = all[pick.index] ?? all[0]
  if (!node) return null
  const kind = kindOf(node, pick, parts)
  const at = all.indexOf(node)
  // A data block's items are styled together; anything else is styled for its page.
  const many = kind === 'dynamic' && !!pick.part
  const others = many ? all.map((_, i) => i).filter((i) => i !== at) : []
  const words = node.closest('[data-qb-words]') ?? node.querySelector('[data-qb-words]')
  return {
    kind,
    count: others.length + 1,
    others,
    editable: kind === 'static' && !!words,
    link: portalLinkOf(node),
  }
}
