/**
 * The styling surface Ask AI's loop works on, as the loop reads it: the
 * style token registry (../style-tokens.ts) seen from the loop, with no data
 * of its own. Each token element with its states and properties, each
 * property with the CSS property the drawn preview is read by and its
 * values, each state with how the verifier forces it; plus the page, whose
 * colours are Theme's. It feeds the model's step schema (step-schema.ts),
 * the context it reads, the verifier and the eval; the adapter
 * (style-ops.ts) turns a style into the design's token operations.
 */
import {
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  STYLE_STATES as TOKEN_STATES,
  type StyleElementInfo,
  type StylePropInfo,
} from '../style-tokens'

export type StyleStateId = (typeof TOKEN_STATES)[number]
export const STYLE_STATES = TOKEN_STATES

export type StyleKind = 'colour' | 'px' | 'em' | 'number' | 'weight' | 'shadow' | 'choice'

export interface StyleProperty {
  id: string
  /** The CSS property it writes and reads. */
  css: string
  kind: StyleKind
  about: string
  min?: number
  max?: number
  choices?: readonly string[]
}

export interface StyleState {
  id: StyleStateId
  about: string
  /** The selector suffix that draws it, such as `:hover`. */
  suffix: string
  /**
   * How the verifier draws it on demand: a pseudo-class it forces through a
   * data attribute, or an attribute state that only shows where the page has
   * one (a voted post), null.
   */
  forced: 'hover' | 'focus' | 'pressed' | null
}

export interface StyleElement {
  id: string
  /** Its name as a person says it. */
  name: string
  about: string
  /** Where it is drawn, in the portal's own attributes. */
  selector: string
  /** Its own selector for the current state, where it has one. */
  current?: string
  states: readonly StyleStateId[]
  properties: readonly string[]
  /** Other words people use for it. */
  aliases: readonly string[]
}

export interface StyleRegistry {
  /** Which registry: 'parts' today, the token system's own name later. */
  source: string
  elements: readonly StyleElement[]
  states: readonly StyleState[]
  properties: readonly StyleProperty[]
}

/** The CSS property the drawn preview reads each token property by. */
const CSS_OF: Record<string, string> = {
  background: 'background-color',
  color: 'color',
  borderColor: 'border-color',
  borderWidth: 'border-width',
  borderStyle: 'border-style',
  radius: 'border-radius',
  shadow: 'box-shadow',
  paddingX: 'padding-left',
  paddingY: 'padding-top',
  size: 'font-size',
  weight: 'font-weight',
  case: 'text-transform',
  tracking: 'letter-spacing',
  leading: 'line-height',
  underline: 'text-decoration-line',
  height: 'min-height',
  lift: 'translate',
  opacity: 'opacity',
  ring: 'outline-color',
  ringWidth: 'outline-width',
}

/** Token properties the loop does not name: a font is a Theme choice, read by family alone. */
const LEFT_OUT = new Set(['font'])

function property(id: string, info: StylePropInfo): StyleProperty {
  const base = { id, css: CSS_OF[id] ?? id, about: info.about }
  switch (info.kind) {
    case 'colour':
    case 'paint':
      return { ...base, kind: 'colour' }
    case 'number':
      return {
        ...base,
        kind:
          id === 'weight'
            ? 'weight'
            : info.unit === 'px'
              ? 'px'
              : info.unit === 'em'
                ? 'em'
                : 'number',
        min: info.min,
        max: info.max,
      }
    case 'choice':
      return {
        ...base,
        kind: id === 'shadow' ? 'shadow' : 'choice',
        choices: Object.keys(info.looks),
      }
  }
}

const STATE_DRAWN: Record<StyleStateId, Pick<StyleState, 'suffix' | 'forced'>> = {
  base: { suffix: '', forced: null },
  hover: { suffix: ':hover', forced: 'hover' },
  focus: { suffix: ':focus-visible', forced: 'focus' },
  active: { suffix: ':active', forced: 'pressed' },
  current: { suffix: '[aria-current=page]', forced: null },
  disabled: { suffix: ':disabled', forced: null },
}

/** The page: its colours are Theme's (the page and text colours), not a token's. */
const PAGE: StyleElement = {
  id: 'page',
  name: 'Page',
  about: 'the page behind everything; its colours are Theme’s',
  selector: 'body',
  states: ['base'],
  properties: ['background', 'color'],
  aliases: ['background', 'site', 'everything'],
}

/** The token registry as the loop reads it. */
export const STYLE_REGISTRY: StyleRegistry = {
  source: 'tokens',
  elements: [
    PAGE,
    ...(Object.entries(STYLE_ELEMENTS) as Array<[string, StyleElementInfo]>).map(([id, el]) => ({
      id,
      name: el.label,
      about: el.about,
      selector: el.selector,
      ...(el.current ? { current: el.current } : {}),
      states: el.states,
      properties: el.props.filter((p) => !LEFT_OUT.has(p)),
      aliases: el.aliases ?? [],
    })),
  ],
  states: TOKEN_STATES.map((id) => ({ id, about: STATE_INFO[id].about, ...STATE_DRAWN[id] })),
  properties: (Object.entries(STYLE_PROPS) as Array<[string, StylePropInfo]>)
    .filter(([id]) => !LEFT_OUT.has(id))
    .map(([id, info]) => property(id, info)),
}

export const elementOf = (registry: StyleRegistry, id: string) =>
  registry.elements.find((element) => element.id === id) ?? null
export const propertyOf = (registry: StyleRegistry, id: string) =>
  registry.properties.find((property) => property.id === id) ?? null
export const stateOf = (registry: StyleRegistry, id: string) =>
  registry.states.find((state) => state.id === id) ?? null

/** What one style or reading is about: an element, a state, and a Home block when only one. */
export interface StyleTarget {
  element: string
  state: StyleStateId
  /** A Home block's type, such as roadmap, narrowing the element to it; '' for all. */
  block: string
  /**
   * Where an override for one place went, as the override names it
   * (part:<id>, page:<page>, block:<id>), to read the element there; '' or
   * left out for the site's look.
   */
  target?: string
}

/** A place an override names, trimmed; '' for everywhere. */
export const placeOf = (t: Pick<StyleTarget, 'target'>) => {
  const place = t.target?.trim() ?? ''
  return /^(everywhere|all|site)$/i.test(place) ? '' : place
}

export const targetKey = (t: StyleTarget) =>
  `${t.element}|${t.state}|${t.block}${placeOf(t) ? `|${placeOf(t)}` : ''}`

/** A target in words: "buttons on hover", "cards in the roadmap block". */
export function targetWords(registry: StyleRegistry, t: StyleTarget): string {
  const name = elementOf(registry, t.element)?.name ?? t.element
  const state =
    t.state === 'base'
      ? ''
      : t.state === 'current'
        ? ' when current'
        : t.state === 'active'
          ? ' when pressed'
          : t.state === 'disabled'
            ? ' when disabled'
            : ` on ${t.state}`
  const block = t.block ? ` in the ${t.block.replace(/_/g, ' ')} block` : ''
  const place = placeOf(t) ? ` at ${placeOf(t)}` : ''
  return `${name}${block}${place}${state}`
}

/**
 * The selector a target draws at: the element, inside the Home block named,
 * in its state. Selector lists are wrapped so a suffix reaches each.
 */
export function targetSelector(registry: StyleRegistry, t: StyleTarget): string | null {
  const element = elementOf(registry, t.element)
  const state = stateOf(registry, t.state)
  if (!element || !state) return null
  const own =
    element.selector.includes(',') && !element.selector.startsWith(':is(')
      ? `:is(${element.selector})`
      : element.selector
  const block = t.block ? `[data-qb-block=${t.block}]` : ''
  const at = element.id === 'block' && block ? `${own}${block}` : block ? `${block} ${own}` : own
  const suffix = t.state === 'current' && element.current ? `:is(${element.current})` : state.suffix
  return `${at}${suffix}`
}

/**
 * The registry for the model, compact: each element with its states and
 * properties, and each property's values. Narrowed to some elements when
 * given (get_context filtered by element kind).
 */
export function registryText(registry: StyleRegistry, only?: readonly string[]): string {
  const elements = only?.length
    ? registry.elements.filter((element) => only.includes(element.id))
    : registry.elements
  const used = new Set(elements.flatMap((element) => element.properties))
  const lines = elements.map(
    (element) =>
      `- ${element.id} (${element.about}): states ${element.states.join(', ')}; properties ${element.properties.join(', ')}`
  )
  const props = registry.properties
    .filter((property) => used.has(property.id))
    .map((property) => {
      const range =
        property.kind === 'colour'
          ? 'a hex colour, or relative: darker, darker 20%, lighter 15%, or a role: accent, support, ink (text), muted, page, surface, raised, border'
          : property.choices
            ? property.choices.join(', ')
            : `${property.min} to ${property.max}${property.kind === 'px' ? 'px' : property.kind === 'em' ? 'em' : ''}`
      return `- ${property.id}: ${property.about}; ${range}`
    })
  const states = registry.states.map((state) => `${state.id} (${state.about})`).join(', ')
  return `Elements:\n${lines.join('\n')}\nStates: ${states}.\nProperties:\n${props.join('\n')}`
}
