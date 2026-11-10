/**
 * How element looks reach an element through the cascade: everywhere, its
 * page, its Home block and its part, each over the last, and which
 * overrides no longer reach anything.
 */
import { effectiveValues } from './effective-values'
import { styleValueWords } from './labels'
import { BLOCK_NAMES } from './names'
import { partOf } from './parts-registry'
import type { PortalDesign } from './schema'
import {
  findOverride,
  setOverrideValue,
  type OverridePage,
  type OverrideTarget,
  type StyleOverride,
} from './style-overrides'
import {
  BLOCK_STYLE_ELEMENTS,
  STYLE_ELEMENTS,
  STYLE_STATES,
  STYLE_PROP_NAMES,
  STYLE_PROPS,
  type ElementStyle,
  type StyleElement,
  type StyleProp,
  type StyleSheet,
  type StyleState,
} from './style-tokens'

/**
 * Overrides whose part (or the block it was in) the design no longer has,
 * or that name an element kind their part is not. They are kept, drawn
 * nowhere, and listed as orphaned.
 */
export function orphanedOverrides(design: PortalDesign): StyleOverride[] {
  return (design.overrides ?? []).filter((o) => {
    if (o.target.scope !== 'part') return false
    const part = partOf(design, o.target.part)
    return !part || !part.elements.includes(o.target.element)
  })
}

type EffectiveValues = ReturnType<typeof effectiveValues>

/* The scopes of a picked element */

/** Where a value is set: one part, its block, its page, or the whole site. */
export type ScopeName = 'part' | 'block' | 'page' | 'everywhere'
/** All screens, or phones only. */
export type Screen = 'all' | 'phone'

/** A picked element: its kind, the part it is, the page it is on and its Home block. */
export interface ElementContext {
  element: StyleElement
  part: string | null
  page: OverridePage | null
  /** Its Home block's id. */
  block: string | null
}

export const SCOPE_NAMES: Record<ScopeName, string> = {
  part: 'This one',
  block: 'This block',
  page: 'This page',
  everywhere: 'Everywhere',
}

const inBlock = (ctx: ElementContext) =>
  !!ctx.block && (BLOCK_STYLE_ELEMENTS as readonly string[]).includes(ctx.element)

/** The scopes an element can be set at, narrowest first. */
export function scopesFor(ctx: ElementContext): ScopeName[] {
  return [
    ...(ctx.part ? (['part'] as const) : []),
    ...(inBlock(ctx) ? (['block'] as const) : []),
    ...(ctx.page ? (['page'] as const) : []),
    'everywhere',
  ]
}

/**
 * The scope a picked element starts at: every one of its kind. A change is
 * shared by default; a one-off (this page, this block, just this one) is a
 * choice made on purpose.
 */
export function defaultScope(_ctx: ElementContext): ScopeName {
  return 'everywhere'
}

/** The scopes an element's dark mode colours can be set at: a Home block's look has no dark layer. */
export function darkScopes(ctx: ElementContext): ScopeName[] {
  return scopesFor(ctx).filter((scope) => scope !== 'block')
}

/** An element's dark mode look at a scope, as stored. */
function darkLookAt(
  design: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName
): ElementStyle | undefined {
  if (scope === 'everywhere') return design.styleDark?.[ctx.element] as ElementStyle | undefined
  if (scope === 'page' && ctx.page)
    return findOverride(design, { scope: 'page', page: ctx.page, element: ctx.element })?.styleDark
  if (scope === 'part' && ctx.part)
    return findOverride(design, { scope: 'part', part: ctx.part, element: ctx.element })?.styleDark
  return undefined
}

/** The dark mode value set exactly at a scope and state; none at a Home block. */
export function readDarkAt(
  design: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  state: StyleState,
  prop: StyleProp
): unknown {
  return (darkLookAt(design, ctx, scope)?.[state] as Record<string, unknown> | undefined)?.[prop]
}

/** Writes one dark mode value at a scope in a draft; undefined clears it. A Home block has none. */
export function writeDarkAt(
  draft: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  state: StyleState,
  prop: StyleProp,
  value: unknown
): void {
  if (scope === 'page' || scope === 'part') {
    const target: OverrideTarget =
      scope === 'page'
        ? { scope: 'page', page: ctx.page!, element: ctx.element }
        : { scope: 'part', part: ctx.part!, element: ctx.element }
    setOverrideValue(draft, target, 'styleDark', state, prop, value)
    return
  }
  if (scope !== 'everywhere') return
  const sheet = (draft.styleDark ??= {}) as Sheet
  const own = (sheet[ctx.element] ??= {})
  const at = (own[state] ??= {})
  if (value === undefined) delete at[prop]
  else at[prop] = value
  if (!Object.keys(at).length) delete own[state]
  if (!Object.keys(own).length) delete sheet[ctx.element]
  if (!Object.keys(sheet).length) delete draft.styleDark
}

type Sheet = Record<string, Record<string, Record<string, unknown>>>

/** The look an element has at a scope and screen, as stored. */
function lookAt(
  design: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  screen: Screen
): ElementStyle | undefined {
  switch (scope) {
    case 'everywhere':
      return (screen === 'phone' ? design.stylePhone : design.style)?.[ctx.element]
    case 'page': {
      if (!ctx.page) return undefined
      const o = findOverride(design, { scope: 'page', page: ctx.page, element: ctx.element })
      return screen === 'phone' ? o?.phone : o?.style
    }
    case 'block': {
      if (!inBlock(ctx)) return undefined
      const look = design.pages.home.blocks.find((b) => b.id === ctx.block)?.look
      const sheet = (screen === 'phone' ? look?.phone : look?.style) as StyleSheet | undefined
      return sheet?.[ctx.element]
    }
    case 'part': {
      if (!ctx.part) return undefined
      const o = findOverride(design, { scope: 'part', part: ctx.part, element: ctx.element })
      return screen === 'phone' ? o?.phone : o?.style
    }
  }
}

/** The value set exactly at a scope, screen and state. */
export function readAt(
  design: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  screen: Screen,
  state: StyleState,
  prop: StyleProp
): unknown {
  return (lookAt(design, ctx, scope, screen)?.[state] as Record<string, unknown> | undefined)?.[
    prop
  ]
}

/** Writes one value at a scope in a draft, dropping what is left empty; undefined clears it. */
export function writeAt(
  draft: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  screen: Screen,
  state: StyleState,
  prop: StyleProp,
  value: unknown
): void {
  if (scope === 'page' || scope === 'part') {
    const target: OverrideTarget =
      scope === 'page'
        ? { scope: 'page', page: ctx.page!, element: ctx.element }
        : { scope: 'part', part: ctx.part!, element: ctx.element }
    setOverrideValue(draft, target, screen === 'phone' ? 'phone' : 'style', state, prop, value)
    return
  }
  const sheetHolder: { sheet?: Sheet; drop: () => void } =
    scope === 'everywhere'
      ? {
          sheet: (screen === 'phone' ? (draft.stylePhone ??= {}) : (draft.style ??= {})) as Sheet,
          drop: () => {
            if (screen === 'phone') delete draft.stylePhone
            else delete draft.style
          },
        }
      : (() => {
          const block = draft.pages.home.blocks.find((b) => b.id === ctx.block)!
          const look = (block.look ??= {})
          const key = screen === 'phone' ? 'phone' : 'style'
          return {
            sheet: (look[key] ??= {}) as Sheet,
            drop: () => {
              delete look[key]
              if (!Object.keys(look).length) delete block.look
            },
          }
        })()
  const sheet = sheetHolder.sheet!
  const own = (sheet[ctx.element] ??= {})
  const at = (own[state] ??= {})
  if (value === undefined) delete at[prop]
  else at[prop] = value
  if (!Object.keys(at).length) delete own[state]
  if (!Object.keys(own).length) delete sheet[ctx.element]
  if (!Object.keys(sheet).length) sheetHolder.drop()
}

/** Clears everything an element sets at a scope and screen, in a draft. */
export function resetAt(
  draft: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  screen: Screen
): void {
  const look = lookAt(draft, ctx, scope, screen)
  for (const [state, props] of Object.entries(look ?? {}))
    for (const prop of Object.keys(props ?? {}))
      writeAt(draft, ctx, scope, screen, state as StyleState, prop as StyleProp, undefined)
}

/** Whether an element sets anything at a scope and screen. */
export function setsAt(
  design: PortalDesign,
  ctx: ElementContext,
  scope: ScopeName,
  screen: Screen
): boolean {
  return Object.values(lookAt(design, ctx, scope, screen) ?? {}).some(
    (props) => !!props && Object.keys(props).length > 0
  )
}

/** What reaches an element: its value and where it comes from. */
export interface Effective {
  value: unknown
  from: ScopeName
  screen: Screen
}

/**
 * The value that reaches an element in a state, on a screen, and where it is
 * set: the narrowest scope that sets it, where at each scope a phone value
 * beats all screens and the state's own value beats its normal one.
 */
export function effectiveValue(
  design: PortalDesign,
  ctx: ElementContext,
  screen: Screen,
  state: StyleState,
  prop: StyleProp
): Effective | null {
  const order: ScopeName[] = ['part', 'block', 'page', 'everywhere']
  const scopes = scopesFor(ctx)
  for (const scope of order) {
    if (!scopes.includes(scope)) continue
    for (const s of screen === 'phone' ? (['phone', 'all'] as const) : (['all'] as const))
      for (const st of state === 'base' ? (['base'] as const) : ([state, 'base'] as const)) {
        const value = readAt(design, ctx, scope, s, st, prop)
        if (value !== undefined) return { value, from: scope, screen: s }
      }
  }
  return null
}

/**
 * What a value set at a scope goes back to when reset: the value that would
 * reach the element without it. At the same scope, a state's normal value and
 * a phone's all-screens value come first; then each wider scope. Null where
 * none is set, and the brand's own value reaches it.
 */
export function widerValue(
  design: PortalDesign,
  ctx: ElementContext,
  at: ScopeName,
  screen: Screen,
  state: StyleState,
  prop: StyleProp
): Effective | null {
  const order: ScopeName[] = ['part', 'block', 'page', 'everywhere']
  const scopes = scopesFor(ctx)
  const screens = screen === 'phone' ? (['phone', 'all'] as const) : (['all'] as const)
  const states = state === 'base' ? (['base'] as const) : ([state, 'base'] as const)
  for (const scope of order.slice(order.indexOf(at))) {
    if (!scopes.includes(scope)) continue
    for (const s of screens)
      for (const st of states) {
        if (scope === at && s === screen && st === state) continue
        const value = readAt(design, ctx, scope, s, st, prop)
        if (value !== undefined) return { value, from: scope, screen: s }
      }
  }
  return null
}

/**
 * Clears what a place set differently holds for an element, in a draft: a
 * page's or a part's override of it, every layer, or a Home block's own look
 * of it on every screen.
 */
export function resetPlace(draft: PortalDesign, element: StyleElement, place: AlsoSet): void {
  if (place.scope === 'block') {
    const block = draft.pages.home.blocks.find((b) => b.id === place.block)
    const look = block?.look
    if (!block || !look) return
    for (const key of ['style', 'phone'] as const) {
      const sheet = look[key] as Record<string, unknown> | undefined
      if (!sheet) continue
      delete sheet[element]
      if (!Object.keys(sheet).length) delete look[key]
    }
    if (!Object.keys(look).length) delete block.look
    return
  }
  const id =
    place.scope === 'page' && place.page
      ? findOverride(draft, { scope: 'page', page: place.page, element })?.id
      : place.part
        ? findOverride(draft, { scope: 'part', part: place.part, element })?.id
        : undefined
  if (!id || !draft.overrides) return
  draft.overrides = draft.overrides.filter((o) => o.id !== id)
  if (!draft.overrides.length) delete draft.overrides
}

/** A narrower place an element's look is set, which a wider change does not reach. */
export interface AlsoSet {
  scope: ScopeName
  label: string
  /** The page, part or block it is. */
  page?: OverridePage
  part?: string
  block?: string
}

const PAGE_LABELS: Record<OverridePage, string> = {
  home: 'Home',
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help Center',
  support: 'Support',
  status: 'Status',
  post: 'A post',
}

/**
 * Where an element's look is also set, narrower than a scope: its pages,
 * blocks and parts. A change at the scope does not reach them.
 */
export function alsoSetAt(design: PortalDesign, ctx: ElementContext, scope: ScopeName): AlsoSet[] {
  const out: AlsoSet[] = []
  const overrides = (design.overrides ?? []).filter((o) => o.target.element === ctx.element)
  if (scope === 'everywhere')
    for (const o of overrides)
      if (o.target.scope === 'page')
        out.push({ scope: 'page', label: PAGE_LABELS[o.target.page], page: o.target.page })
  if (scope === 'everywhere' || (scope === 'page' && ctx.page === 'home'))
    for (const block of design.pages.home.blocks) {
      const has =
        (block.look?.style as StyleSheet | undefined)?.[ctx.element] ??
        (block.look?.phone as StyleSheet | undefined)?.[ctx.element]
      if (has && block.id)
        out.push({
          scope: 'block',
          label: blockLabel(design, block.id),
          block: block.id,
        })
    }
  if (scope !== 'part')
    for (const o of overrides) {
      if (o.target.scope !== 'part') continue
      const part = partOf(design, o.target.part)
      if (!part) continue
      if (scope === 'page' && !(ctx.page && part.pages.length === 1 && part.pages[0] === ctx.page))
        continue
      if (scope === 'block' && part.block !== ctx.block) continue
      out.push({
        scope: 'part',
        label: `${part.label} · ${part.group.replace(/ · .*$/, '')}`,
        part: part.id,
      })
    }
  return out
}

function blockLabel(design: PortalDesign, id: string): string {
  const block = design.pages.home.blocks.find((b) => b.id === id)
  if (!block) return 'A block'
  return (
    ('title' in block && block.title) ||
    block.heading?.en ||
    Object.values(block.heading ?? {})[0] ||
    BLOCK_NAMES[block.type]
  )
}

/* Naming overrides, for lists and the publish summary */

/** What an override is set on: "Call to action · Hero", "Main buttons on Feedback". */
export function overrideName(design: PortalDesign, o: StyleOverride): string {
  const el = STYLE_ELEMENTS[o.target.element]
  if (o.target.scope === 'page') return `${el.label} on ${PAGE_LABELS[o.target.page]}`
  const part = partOf(design, o.target.part)
  if (part && part.elements.includes(o.target.element))
    return `${part.label} · ${part.group.replace(/ · .*$/, '')}`
  const where = o.target.part.startsWith('block.')
    ? 'a block that is gone'
    : o.target.part.startsWith('nav.')
      ? 'a menu item that is gone'
      : 'a part that is gone'
  return `${el.label} in ${where}`
}

/** The properties an override sets, as their names, once each, in the registry's order. */
export function overrideProps(o: StyleOverride | undefined): StyleProp[] {
  const set = new Set<string>()
  for (const layer of ['style', 'styleDark', 'phone'] as const)
    for (const props of Object.values(o?.[layer] ?? {}))
      for (const prop of Object.keys(props ?? {})) set.add(prop)
  return STYLE_PROP_NAMES.filter((prop) => set.has(prop))
}

/** The properties two versions of an override set differently. */
export function changedProps(
  a: StyleOverride | undefined,
  b: StyleOverride | undefined
): StyleProp[] {
  const value = (
    o: StyleOverride | undefined,
    layer: 'style' | 'styleDark' | 'phone',
    prop: string
  ) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(o?.[layer] ?? {}).map(([state, props]) => [
          state,
          (props as Record<string, unknown> | undefined)?.[prop],
        ])
      )
    )
  return STYLE_PROP_NAMES.filter((prop) =>
    (['style', 'styleDark', 'phone'] as const).some(
      (layer) => value(a, layer, prop) !== value(b, layer, prop)
    )
  )
}

/** Property names as a short list: "background, corners". */
export function propList(props: readonly StyleProp[]): string {
  return props.map((prop) => STYLE_PROPS[prop].label.toLowerCase()).join(', ')
}

/* An override change in plain words, for Quackback AI's change card */

/** A state as a change line says it, after the property. */
const STATE_WORDS: Record<StyleState, string> = {
  base: '',
  hover: ' on hover',
  active: ' when pressed',
  focus: ' on focus',
  current: ' when current',
  disabled: ' when disabled',
}

/**
 * The colour role the theme draws an element's fill or text in where no
 * style sets it, for saying what an override took over from; undefined
 * where the theme's value has no role's name.
 */
export function themeRole(
  design: PortalDesign,
  element: StyleElement,
  prop: StyleProp
): string | undefined {
  const inkFill = design.shape.fill === 'ink'
  const roles: Partial<Record<StyleElement, Partial<Record<StyleProp, string>>>> = {
    button: {
      background: inkFill ? 'ink' : 'accent',
      borderColor: inkFill ? 'ink' : 'accent',
      color: inkFill ? 'page' : 'on-accent',
    },
    secondary: { background: 'transparent', color: 'ink', borderColor: 'border' },
    ghost: { background: 'transparent', color: 'ink' },
    link: { color: 'accent-text' },
    navItem: { color: 'muted' },
    card: { background: 'surface', color: 'ink', borderColor: 'border' },
    block: { background: 'surface', color: 'ink', borderColor: 'border' },
    input: { background: 'surface', borderColor: 'border' },
    headline: { color: 'ink' },
    heading: { color: 'ink' },
    subtitle: { color: 'muted' },
    body: { color: 'ink' },
  }
  return roles[element]?.[prop]
}

/** The numbers the brand's choices and exact values give an element, by property. */
const BRAND_NUMBERS: Partial<
  Record<StyleElement, Partial<Record<StyleProp, (v: EffectiveValues) => number | undefined>>>
> = {
  button: {
    radius: (v) => v.button.radius,
    height: (v) => v.button.height,
    size: (v) => v.label.size,
    weight: (v) => v.label.weight,
  },
  navItem: { size: (v) => v.label.size, weight: (v) => v.label.weight },
  card: { radius: (v) => v.card.radius },
  input: { radius: (v) => v.field.radius },
  headline: {
    size: (v) => v.headline.size,
    weight: (v) => v.headline.weight,
    tracking: (v) => v.headline.tracking,
  },
  heading: { size: (v) => v.heading.size, weight: (v) => v.heading.weight },
}

/**
 * What an element has from the brand where no style sets it: the colour role
 * the theme draws it in, or the number its choices and exact values give.
 * Undefined where the brand's value is not known here.
 */
export function brandValue(
  design: PortalDesign,
  element: StyleElement,
  prop: StyleProp
): string | number | undefined {
  const info = STYLE_PROPS[prop]
  if (info.kind === 'colour' || info.kind === 'paint') return themeRole(design, element, prop)
  const read = BRAND_NUMBERS[element]?.[prop]
  return read ? read(effectiveValues(design)) : undefined
}

/** Where an override's element is, as the cascade reads it. */
function contextOfOverride(design: PortalDesign, o: StyleOverride): ElementContext {
  if (o.target.scope === 'page')
    return { element: o.target.element, part: null, page: o.target.page, block: null }
  const part = partOf(design, o.target.part)
  return {
    element: o.target.element,
    part: o.target.part,
    page: part?.pages[0] ?? null,
    block: part?.block ?? null,
  }
}

/**
 * Each value a change to the overrides set differently, in plain words,
 * from what reached the element before to what reaches it now, and where:
 * "Call to action background: Brand → Black (this one)".
 */
export function overrideChangeLines(
  design: PortalDesign,
  before: readonly StyleOverride[] | null | undefined,
  after: readonly StyleOverride[] | null | undefined
): string[] {
  const was: PortalDesign = { ...design, overrides: [...(before ?? [])] }
  const now: PortalDesign = { ...design, overrides: [...(after ?? [])] }
  const ids = [...new Set([...(before ?? []), ...(after ?? [])].map((o) => o.id))]
  const lines: string[] = []
  for (const id of ids) {
    const a = findOverride(was, id)
    const b = findOverride(now, id)
    const o = (b ?? a)!
    const ctx = contextOfOverride(design, o)
    const part = o.target.scope === 'part' ? partOf(design, o.target.part) : null
    const subject =
      o.target.scope === 'page'
        ? `${STYLE_ELEMENTS[o.target.element].label} on ${PAGE_LABELS[o.target.page]}`
        : part
          ? part.label
          : overrideName(design, o)
    const scope = o.target.scope === 'part' ? 'this one' : 'this page'
    for (const layer of ['style', 'phone', 'styleDark'] as const)
      for (const state of STYLE_STATES)
        for (const prop of STYLE_PROP_NAMES) {
          const value = (x: StyleOverride | undefined) =>
            (x?.[layer]?.[state] as Record<string, unknown> | undefined)?.[prop]
          if (JSON.stringify(value(a)) === JSON.stringify(value(b))) continue
          const reaching = (d: PortalDesign, own: StyleOverride | undefined) => {
            if (layer === 'styleDark') return value(own) ?? 'as in light mode'
            const found = effectiveValue(d, ctx, layer === 'phone' ? 'phone' : 'all', state, prop)
            if (found) return found.value
            // A part drawn as one of several kinds (a primary or a quiet button) has no one theme colour.
            return part && part.elements.length > 1
              ? undefined
              : themeRole(design, o.target.element, prop)
          }
          const words = (v: unknown) =>
            v === undefined
              ? 'Theme default'
              : v === 'as in light mode'
                ? 'As in light mode'
                : styleValueWords(prop, v)
          const screen =
            layer === 'phone' ? ' on phones' : layer === 'styleDark' ? ' in dark mode' : ''
          lines.push(
            `${subject} ${STYLE_PROPS[prop].label.toLowerCase()}${STATE_WORDS[state]}${screen}: ${words(reaching(was, a))} → ${words(reaching(now, b))} (${scope})`
          )
        }
  }
  return lines
}
