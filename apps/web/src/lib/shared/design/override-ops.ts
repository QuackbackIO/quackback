/**
 * Quackback AI's override operation, read from what the model writes: an
 * element's look set for one part ("just this button"), one page ("only on
 * the roadmap page"), one Home block, or everywhere; on all screens, on
 * phones or in dark mode; in a state.
 *
 *   {op: "override", target: "part:hero.home.cta", key: "button.hover.background", value: "ink"}
 *
 * target: part:<part id> (or the bare id), page:<page> (or "roadmap page"),
 * block:<block id>, or everywhere. key: [phone.|dark.]<element>.<state>.<prop>,
 * where the state may be left out for normal and, on a part of one element
 * kind, the element too. The builder's own paths,
 * overrides.<id>.<style|styleDark|phone>.<state>.<prop> and
 * stylePhone.<element>.<state>.<prop>, read the same.
 *
 * Pure: it reads and writes the design through the cascade's own helpers,
 * so the AI and the inspector write the same values in the same places.
 */
import { BLOCK_NAMES, PAGE_NAMES } from './names'
import { writeAt, type ElementContext, type ScopeName } from './override-cascade'
import { allPartsOf, partsOf, type PartInfo } from './parts-registry'
import type { PortalDesign } from './schema'
import {
  LAYER_PROPS,
  overridePath,
  setOverrideValue,
  type OverrideLayer,
  type OverridePage,
} from './style-overrides'
import {
  BLOCK_STYLE_ELEMENTS,
  COLOUR_PROPS,
  readStyleValue,
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  STYLE_STATES,
  styleAllows,
  type StyleElement,
  type StyleProp,
  type StyleState,
} from './style-tokens'
import { DESIGN_OPTIONS } from './options'
import type { DesignAiScope } from './apply-changes'

/** Where an override goes. */
export type OverrideWhere =
  | { kind: 'part'; part: PartInfo }
  | { kind: 'page'; page: OverridePage }
  | { kind: 'block'; block: string; name: string }
  | { kind: 'everywhere' }

/** One override operation, read. */
export interface OverrideOp {
  where: OverrideWhere
  /** All screens, phones' own sizes, or dark mode's own colours. */
  layer: OverrideLayer
  element: StyleElement
  state: StyleState
  prop: StyleProp
  /** The value to set; undefined clears it. */
  value: unknown
}

type Read<T> = { ok: true; read: T } | { ok: false; refusal: string }
const no = (refusal: string): { ok: false; refusal: string } => ({ ok: false, refusal })

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[_\s-]+/g, ' ')
    .trim()

const listed = (words: readonly string[], or = 'or') =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} ${or} ${words.at(-1)}` : (words[0] ?? '')

const PAGES = DESIGN_OPTIONS.backgroundPage as readonly OverridePage[]
const PAGE_WORDS: Record<string, OverridePage> = {
  'help center': 'help',
  'help centre': 'help',
  'knowledge base': 'help',
  ideas: 'feedback',
  'feedback board': 'feedback',
  posts: 'post',
  'a post': 'post',
  'post page': 'post',
  'status page': 'status',
  'home page': 'home',
  homepage: 'home',
}

/** The page a word names, such as "roadmap", "the Roadmap page", "page:help" or "help center". */
export function overridePageOf(word: string): OverridePage | null {
  const w = norm(word.replace(/^page:/i, ''))
    .replace(/^the /, '')
    .replace(/ page$/, '')
  if ((PAGES as readonly string[]).includes(w)) return w as OverridePage
  return PAGE_WORDS[w] ?? PAGE_WORDS[`${w} page`] ?? null
}

const EVERYWHERE = new Set(['', 'everywhere', 'site', 'all', 'every page', 'all pages', 'theme'])

/** Where a target names. */
/** Where an override's target names, read as the override operation reads it. */
export function whereOf(design: PortalDesign, target: string): Read<OverrideWhere> {
  const t = target.trim()
  if (EVERYWHERE.has(norm(t))) return { ok: true, read: { kind: 'everywhere' } }
  const parts = partsOf(design)
  const block = /^block:(.+)$/i.exec(t)
  if (block) {
    const found = design.pages.home.blocks.find((b) => b.id === block[1]!.trim())
    if (!found)
      return no(
        `Home has no block ${block[1]}; its blocks are ${listed(design.pages.home.blocks.map((b) => `${b.id} (${BLOCK_NAMES[b.type]})`))}`
      )
    return { ok: true, read: { kind: 'block', block: found.id!, name: BLOCK_NAMES[found.type] } }
  }
  const page = /^page:/i.test(t) || / page$/i.test(t) ? overridePageOf(t) : null
  if (page) return { ok: true, read: { kind: 'page', page } }
  if (/^page:/i.test(t))
    return no(`There is no page ${t.slice(5)}; a page is one of ${listed([...PAGES])}`)
  const id = t.replace(/^part:/i, '')
  // A data block's items too, which are named when picked on the canvas.
  const all = allPartsOf(design)
  const part =
    all.find((p) => p.id === id) ?? all.find((p) => p.id.toLowerCase() === id.toLowerCase())
  if (part) return { ok: true, read: { kind: 'part', part } }
  const bare = overridePageOf(t)
  if (bare) return { ok: true, read: { kind: 'page', page: bare } }
  const own = id.split('.')[0]
  const near = parts.filter((p) => p.id.startsWith(`${own}.`)).map((p) => p.id)
  return no(
    `There is no part called ${id}${near.length ? `; there are ${listed(near.slice(0, 8))}` : ''}`
  )
}

/** A key's segments, past the layer it may start with. */
function layerOf(key: string): { layer: OverrideLayer; rest: string[] } {
  const parts = key.trim().split('.').filter(Boolean)
  const first = parts[0]?.toLowerCase()
  if (first === 'phone' || first === 'phones' || first === 'stylephone')
    return { layer: 'phone', rest: parts.slice(1) }
  if (first === 'dark' || first === 'styledark') return { layer: 'styleDark', rest: parts.slice(1) }
  if (first === 'style') return { layer: 'style', rest: parts.slice(1) }
  return { layer: 'style', rest: parts }
}

const isElement = (word: string | undefined): word is StyleElement =>
  !!word && word in STYLE_ELEMENTS
const isState = (word: string | undefined): word is StyleState =>
  !!word && (STYLE_STATES as readonly string[]).includes(word)
const STATE_WORDS: Record<string, StyleState> = { pressed: 'active', normal: 'base', rest: 'base' }

const partName = (part: PartInfo) => `${part.label} · ${part.group.replace(/ · .*$/, '')}`

/**
 * The override a key and value write, at a place: its element (the part's
 * own where the key leaves it out), state and property, checked against the
 * registry and what the place holds.
 */
function readKey(where: OverrideWhere, key: string, raw: unknown): Read<Omit<OverrideOp, 'where'>> {
  const { layer, rest } = layerOf(key)
  if (rest.length === 0 || rest.length > 3)
    return no('An override’s key is <element>.<state>.<property>, such as button.hover.background')
  const words = rest.map((w) => STATE_WORDS[w.toLowerCase()] ?? w)
  let element: string | undefined = isElement(words[0]) ? words.shift() : undefined
  const state: string = isState(words[0]) && words.length > 1 ? words.shift()! : 'base'
  if (!element && words.length > 1) element = words.shift()
  const prop = words[0]
  if (words.length !== 1 || !prop)
    return no(`An override’s key is <element>.<state>.<property>, not ${key}`)
  if (where.kind === 'part') {
    const own = where.part.elements
    if (!element) {
      if (own.length > 1)
        return no(
          `${partName(where.part)} is more than one kind of thing: name one: ${listed([...own])}`
        )
      element = own[0]
    } else if (!(own as readonly string[]).includes(element))
      return no(`${partName(where.part)} is a ${listed([...own])}, not a ${element}`)
  }
  if (!element) return no(`Name the element, such as button.${state}.${prop}`)
  if (!isElement(element))
    return no(`There is no element ${element}; there are ${listed(Object.keys(STYLE_ELEMENTS))}`)
  if (where.kind === 'block' && !(BLOCK_STYLE_ELEMENTS as readonly string[]).includes(element))
    return no(
      `A block’s own look sets what is in it: ${listed([...BLOCK_STYLE_ELEMENTS])}, not ${element}`
    )
  const el = STYLE_ELEMENTS[element]
  if (!styleAllows(element, state, prop))
    return no(
      `${el.label} ${(el.states as readonly string[]).includes(state) ? `has no ${prop} ${STATE_INFO[state as StyleState]?.label.toLowerCase() ?? state}` : `has no ${state} state`}; it takes ${listed([...el.props])} in ${listed([...el.states])}`
    )
  const only = LAYER_PROPS[layer]
  if (only && !only.includes(prop as StyleProp))
    return no(
      layer === 'phone'
        ? `Phones take sizes and shapes; colours follow the mode on every screen, so ${prop} is set for all screens`
        : `Dark mode sets its own ${listed([...COLOUR_PROPS])} only`
    )
  if (layer === 'styleDark' && where.kind === 'block')
    return no('A block’s own look has no dark mode of its own; set the colour for its page or part')
  const value =
    raw === null || raw === 'null' || raw === ''
      ? undefined
      : readStyleValue(prop as StyleProp, raw)
  return {
    ok: true,
    read: { layer, element, state: state as StyleState, prop: prop as StyleProp, value },
  }
}

/** An override operation as written: a target and a key, or one of the builder's paths. */
export function readOverrideOp(
  design: PortalDesign,
  target: string | undefined,
  key: string | undefined,
  value: unknown
): Read<OverrideOp> {
  const k = (key ?? '').trim()
  // The builder's own path: overrides.<id>.<layer>.<state>.<prop>.
  if (/^overrides\./.test(k)) {
    const path = overridePath(k)
    if (!path) return no(`${k} is no override this design can hold`)
    const t = path.target
    const where =
      t.scope === 'page' ? whereOf(design, `page:${t.page}`) : whereOf(design, `part:${t.part}`)
    if (!where.ok) return where
    return readOverrideOp(
      design,
      t.scope === 'page' ? `page:${t.page}` : `part:${t.part}`,
      `${path.layer === 'style' ? '' : path.layer === 'phone' ? 'phone.' : 'dark.'}${t.element}.${path.state}.${path.prop}`,
      value
    )
  }
  if (/^stylePhone\./.test(k))
    return readOverrideOp(design, 'everywhere', `phone.${k.slice(11)}`, value)
  const where = whereOf(design, target ?? '')
  if (!where.ok) return where
  const read = readKey(where.read, k, value)
  if (!read.ok) return read
  // A Home block's slot (its heading, its links) is what the block's own look styles in it:
  // written there, where the builder's "This block" reads it; dark mode's own stays the part's.
  const part = where.read.kind === 'part' ? where.read.part : null
  if (part?.block && read.read.layer !== 'styleDark') {
    const block = design.pages.home.blocks.find((b) => b.id === part.block)
    if (block)
      return {
        ok: true,
        read: {
          where: { kind: 'block', block: part.block, name: BLOCK_NAMES[block.type] },
          ...read.read,
        },
      }
  }
  return { ok: true, read: { where: where.read, ...read.read } }
}

/**
 * A set operation aimed at a part or a block by the override's own names
 * (target part:<id>, block:<id> or a part's bare id, key style.<element>...),
 * as the override it means; null for any other.
 */
export function setAsOverride(
  design: PortalDesign,
  op: { op: string; target?: string; key?: string; value?: string }
): { op: 'override'; target: string; key: string; value?: string } | null {
  if (op.op !== 'set' || !op.target) return null
  const t = op.target.trim()
  const named = /^(part|block):/i.test(t) || allPartsOf(design).some((p) => p.id === t)
  if (!named) return null
  return {
    op: 'override',
    target: t,
    key: (op.key ?? '').replace(/^style\./, ''),
    ...(op.value !== undefined ? { value: op.value } : {}),
  }
}

/** Writes an override operation into a draft. */
export function writeOverride(draft: PortalDesign, o: OverrideOp): boolean {
  const { where, layer, element, state, prop, value } = o
  if (where.kind === 'part' || where.kind === 'page')
    return setOverrideValue(
      draft,
      where.kind === 'part'
        ? { scope: 'part', part: where.part.id, element }
        : { scope: 'page', page: where.page, element },
      layer,
      state,
      prop,
      value
    )
  const ctx: ElementContext = {
    element,
    part: null,
    page: null,
    block: where.kind === 'block' ? where.block : null,
  }
  const scope: ScopeName = where.kind === 'block' ? 'block' : 'everywhere'
  if (layer !== 'styleDark') {
    writeAt(draft, ctx, scope, layer === 'phone' ? 'phone' : 'all', state, prop, value)
    return true
  }
  // Dark mode's own colours everywhere live in styleDark, beside style.
  const sheet = (draft.styleDark ??= {}) as Record<string, Record<string, Record<string, unknown>>>
  const own = (sheet[element] ??= {})
  const at = (own[state] ??= {})
  if (value === undefined) delete at[prop]
  else at[prop] = value
  if (!Object.keys(at).length) delete own[state]
  if (!Object.keys(own).length) delete sheet[element]
  if (!Object.keys(sheet).length) delete draft.styleDark
  return true
}

const PAGE_LABELS: Record<OverridePage, string> = {
  ...(PAGE_NAMES as Record<string, string>),
  post: 'a post',
} as Record<OverridePage, string>

/** Where an override goes, in words: "Call to action · Hero", "buttons on Roadmap". */
function whereWords(o: OverrideOp): string {
  const el = STYLE_ELEMENTS[o.element].label.toLowerCase()
  switch (o.where.kind) {
    case 'part':
      return partName(o.where.part)
    case 'page':
      return `${el} on ${PAGE_LABELS[o.where.page] ?? o.where.page}`
    case 'block':
      return `${el} in ${o.where.name}`
    case 'everywhere':
      return el
  }
}

/** What an override operation did, as its undo names it. */
export function overrideLabel(o: OverrideOp): string {
  const prop = STYLE_PROPS[o.prop].label.toLowerCase()
  const state = o.state === 'base' ? '' : ` (${STATE_INFO[o.state].label.toLowerCase()})`
  const screen = o.layer === 'phone' ? ' on phones' : o.layer === 'styleDark' ? ' in dark mode' : ''
  const spoken =
    o.value === undefined ? 'cleared' : typeof o.value === 'object' ? 'set' : String(o.value)
  const head = whereWords(o)
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}: ${prop}${state}${screen} ${o.value === undefined ? spoken : `to ${spoken}`}`
}

/* Whether an override stays within what was picked */

/** The element kinds each picked part of the portal reaches. */
const SCOPE_ELEMENTS: Partial<Record<DesignAiScope, readonly StyleElement[]>> = {
  button: ['button'],
  secondary: ['secondary', 'ghost'],
  card: ['card'],
  vote: ['vote'],
  field: ['input'],
  status: ['badge'],
  link: ['link'],
  body: ['body'],
  heading: ['heading'],
  headline: ['headline'],
  subtitle: ['subtitle'],
  menu: ['navItem'],
}
/** The pages each picked part of the portal is on. */
const SCOPE_PAGES: Partial<Record<DesignAiScope, readonly OverridePage[]>> = {
  home: ['home'],
  feed: ['feedback'],
  filters: ['feedback'],
  welcome: ['feedback'],
  roadmap: ['roadmap'],
  changelog: ['changelog'],
  help: ['help'],
}
/** The parts each picked part of the portal holds, by their names' start. */
const SCOPE_PARTS: Partial<Record<DesignAiScope, readonly string[]>> = {
  header: ['header.', 'nav.'],
  menu: ['nav.'],
  band: ['hero.', 'title.'],
  headline: ['hero.'],
  subtitle: ['hero.'],
  home: ['block.', 'hero.home.'],
  feed: ['feed.'],
  filters: ['feed.filters'],
}

/**
 * Whether an override operation stays within what was picked: a part of the
 * section picked, its page, an element kind picked; the picked Home block's
 * own look and parts. Everywhere is for the site, or an element kind picked.
 */
export function overrideInScope(
  o: OverrideOp,
  within: {
    scope: DesignAiScope
    blockId?: string
    element?: { element: StyleElement; part: string | null }
  }
): boolean {
  const { scope, blockId } = within
  if (scope === 'site' || scope === 'brand') return true
  const { where } = o
  // An element picked: every one of its kind, those on a page, or the one picked, as its panel offers.
  if (within.element && o.element === within.element.element) {
    if (where.kind === 'everywhere' || where.kind === 'page') return true
    if (where.kind === 'part' && where.part.id === within.element.part) return true
  }
  if (blockId)
    return (
      (where.kind === 'block' && where.block === blockId) ||
      (where.kind === 'part' && where.part.block === blockId)
    )
  const elements = SCOPE_ELEMENTS[scope]
  if (elements) return elements.includes(o.element)
  switch (where.kind) {
    case 'part':
      return (
        (SCOPE_PARTS[scope] ?? []).some((start) => where.part.id.startsWith(start)) ||
        (where.part.pages.length === 1 && (SCOPE_PAGES[scope] ?? []).includes(where.part.pages[0]!))
      )
    case 'page':
      return (SCOPE_PAGES[scope] ?? []).includes(where.page)
    case 'block':
      return scope === 'home'
    case 'everywhere':
      return false
  }
}

/**
 * Whether an override stays as near as the request may reach: anywhere for
 * every page; on the page shown (its page, a part only there, a Home block
 * on Home) for one page; the part picked, or the Home block picked, for one.
 */
export function overrideInReach(
  o: OverrideOp,
  within: {
    blockId?: string
    element?: { part: string | null }
    reach?: 'one' | 'page' | 'every'
    page?: OverridePage
  }
): boolean {
  const { reach, page } = within
  if (!reach || reach === 'every') return true
  const { where } = o
  if (reach === 'one') {
    const part = within.element?.part
    if (part) {
      if (where.kind === 'part') return where.part.id === part
      // A Home block's slot is written as the block's own look.
      if (where.kind === 'block') return part.startsWith(`block.${where.block}.`)
      return false
    }
    if (within.blockId)
      return (
        (where.kind === 'block' && where.block === within.blockId) ||
        (where.kind === 'part' && where.part.block === within.blockId)
      )
  }
  if (!page) return false
  switch (where.kind) {
    case 'page':
      return where.page === page
    case 'part':
      return where.part.pages.length === 1 && where.part.pages[0] === page
    case 'block':
      return page === 'home'
    case 'everywhere':
      return false
  }
}

/**
 * The parts a picked section holds that are drawn as an element kind, on
 * the page given or on every page: the hero's buttons for a hover asked of
 * the hero, so a style lands on them as overrides, never on every button.
 */
export function pickedParts(
  design: PortalDesign,
  scope: DesignAiScope,
  element: StyleElement,
  page?: OverridePage
): PartInfo[] {
  const starts = SCOPE_PARTS[scope] ?? []
  return partsOf(design).filter(
    (part) =>
      starts.some((start) => part.id.startsWith(start)) &&
      (part.elements as readonly string[]).includes(element) &&
      (!page || (part.pages.length === 1 && part.pages[0] === page))
  )
}

/* What the AI is told */

/**
 * The parts a design has, which an override for "just this one" names:
 * grouped as the builder groups them, each with its name and element kinds.
 */
export function partsText(design: PortalDesign): string {
  const groups = new Map<string, string[]>()
  for (const part of partsOf(design)) {
    // The footer is the only one of its kind: its look everywhere is op theme style.footer.
    if (part.elements.includes('footer')) continue
    const list = groups.get(part.group) ?? []
    list.push(`${part.id} (${part.label.replace(/^Menu item · /, '')}, ${part.elements.join('/')})`)
    groups.set(part.group, list)
  }
  return [...groups.entries()].map(([group, list]) => `${group}: ${list.join(', ')}`).join('; ')
}

const leaves = (value: unknown, at: string): string[] => {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object' || 'from' in (value as object))
    return [`${at}=${JSON.stringify(value)}`]
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, `${at}.${k}`)
  )
}

/** The overrides and phones' own values set now, as paths, for the AI to change rather than set over. */
export function overridesNow(design: PortalDesign): string {
  const set = [
    ...(design.overrides ?? []).flatMap((o) =>
      (['style', 'styleDark', 'phone'] as const).flatMap((layer) =>
        leaves(o[layer], `${o.id} ${layer}`)
      )
    ),
    ...leaves(design.stylePhone, 'stylePhone'),
    ...design.pages.home.blocks.flatMap((b) => leaves(b.look?.phone, `${b.id} phone`)),
  ]
  return set.length ? set.join(', ') : 'none'
}

/** The rule for the override operation, as Ask AI's prompt tells it. */
export const OVERRIDE_RULE = `- override: an element's look for one part, one page, one Home block or everywhere, on all screens, phones or dark mode. target: part:<part id> for "this one", "just this button", "only the hero's call to action" (the parts below); page:<page> (${PAGES.join(', ')}) for "only on the roadmap page", every one of that element on it; block:<block id> for one Home block's own look; everywhere for the whole portal. key: <element>.<state>.<property>, the state left out for normal, such as button.hover.background; on a part of one element kind the element may be left out; start it with phone. for phones only (sizes and shapes, never colours: phone.headline.size), or dark. for dark mode's own colour. value as for style; null clears it. A request about one part, one page or phones is an override. A request that names an element by its kind, with no "just", "only", "this" or a page ("the footer", "buttons", "the vote boxes"), is about every one of it: op theme style.<element>..., never a part. "This", "this one" and "just this" mean the part picked when one is; with none picked, name the part.`
