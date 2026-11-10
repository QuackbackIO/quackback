/**
 * A reading worked out from the design itself rather than drawn: the colours
 * the theme solves, the sizes the choices and exact values give, and the
 * styles Ask AI wrote, state by state. The builder reads the drawn preview
 * (lib/client/style-reader.ts); this stands in where nothing is drawn, in
 * the eval and on the server, and gives a relative colour ("darker") its
 * starting point. It models the portal's rules, so where the two disagree
 * the drawn preview is right.
 */
import { resolveDesign } from '../resolve'
import { brandValues, LABEL_WEIGHT } from '../effective-values'
import type { PortalDesign } from '../schema'
import { tuneHexes } from '../tune'
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { parseCssColour, SHADOW_PRESETS } from './css-values'
import { STYLE_ELEMENTS, type StyleProp } from '../style-tokens'
import { whereOf } from '../override-ops'
import type { OverridePage } from '../style-overrides'
import {
  elementOf,
  placeOf,
  targetKey,
  type StyleRegistry,
  type StyleTarget,
} from './style-registry'
import type { ElementReading, Readings } from './verify'

const hex = (value: string | undefined | null): string => {
  const colour = parseCssColour(value ?? '')
  return colour ? colour.hex : '#000000'
}

/** Every property a token can set. */
const TOKEN_PROPS = [
  ...new Set(Object.values(STYLE_ELEMENTS).flatMap((el) => el.props as readonly string[])),
]

/** A token's variable as the drawn preview would read it. */
function readingOf(prop: StyleProp, value: string, values: Record<string, string>): string {
  const px = (v: string) => [...v.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]!))
  switch (prop) {
    case 'background': {
      // A gradient reads by its first colour.
      const first = /^linear-gradient\([^,]+,\s*([^,]+?)\s*,/.exec(value)
      return first ? first[1]! : value
    }
    case 'size': {
      const all = px(value)
      return all.length ? `${all[all.length - 1]}px` : value
    }
    case 'tracking': {
      const em = parseFloat(value)
      const size = parseFloat(values.size ?? '16') || 16
      return `${em * size}px`
    }
    case 'lift':
      return `0px -${parseFloat(value)}px`
    default:
      return value
  }
}

/** The mode the design is mostly seen in. */
export const shownMode = (design: PortalDesign): 'light' | 'dark' =>
  design.mode === 'dark' ? 'dark' : 'light'

const pxs = (n: number) => `${n}px`

/** Each element's values at rest, from the design's choices and exact values. */
function baseValues(
  design: PortalDesign,
  element: string,
  vars: Required<ThemeVariables>,
  tokens: Record<string, string>
): Record<string, string> {
  const values = brandValues(design)
  const tune = tuneHexes(design) ?? {}
  const dark = shownMode(design) === 'dark'
  const cardShadow = tune.card?.shadow ?? (design.layout.cards === 'raised' ? 'soft' : 'none')
  const cardBorder = tune.card?.border ?? (design.layout.cards === 'bordered' ? 1 : 0)
  switch (element) {
    case 'page':
      return { background: vars.background, color: vars.foreground }
    case 'button': {
      const fill =
        (!dark && tune.button?.fill) ||
        (design.shape.fill === 'ink' ? vars.foreground : vars.primary)
      const ink =
        (!dark && tune.button?.ink) ||
        (design.shape.fill === 'ink' ? vars.background : vars.primaryForeground)
      return {
        background: fill,
        color: ink,
        borderColor: fill,
        borderWidth: '0px',
        radius: pxs(values.button.radius),
        shadow: 'none',
        height: pxs(values.button.height),
        weight: String(tune.button?.weight ?? values.label.weight ?? LABEL_WEIGHT),
        case:
          tune.button?.case === 'upper' || design.brand.fonts.labelCase === 'upper'
            ? 'uppercase'
            : 'none',
        tracking: 'normal',
        lift: 'none',
        opacity: '1',
      }
    }
    case 'secondary':
    case 'ghost':
      return {
        background: 'transparent',
        color: vars.foreground,
        borderColor: vars.border,
        borderWidth: '1px',
        radius: pxs(values.button.radius),
        shadow: 'none',
        weight: String(values.label.weight),
        case: 'none',
      }
    case 'postCard':
    case 'panel':
    case 'block':
      return {
        background: design.layout.cards === 'list' ? 'transparent' : vars.card,
        color: vars.foreground,
        borderColor: vars.border,
        borderWidth: pxs(cardBorder),
        radius: pxs(values.card.radius),
        shadow:
          SHADOW_PRESETS[
            cardShadow === 'soft' ? 'soft' : cardShadow === 'lifted' ? 'lifted' : 'none'
          ],
        lift: 'none',
      }
    case 'link':
      return {
        color: (!dark && tune.link?.colour) || vars.accentInk || vars.primary,
        weight: String(tune.link?.weight ?? 500),
        underline: tune.link?.underline === 'always' ? 'underline' : 'none',
      }
    case 'navItem':
      return {
        background: 'transparent',
        color: tokens['--qb-nav-ink'] ?? vars.mutedForeground,
        radius: design.layout.nav === 'pills' ? '999px' : '6px',
        weight: String(values.label.weight),
        underline: 'none',
        case: design.brand.fonts.labelCase === 'upper' ? 'uppercase' : 'none',
      }
    case 'header':
      return {
        background: tokens['--qb-header-bg'] ?? vars.background,
        color: vars.foreground,
        borderColor: vars.border,
        borderWidth: '1px',
        shadow: 'none',
      }
    case 'headline':
      return {
        color:
          (!dark && tune.headline?.colour) ||
          (design.brand.fonts.headlineColour === 'accent'
            ? (tokens['--qb-band-accent'] ?? vars.primary)
            : (tokens['--qb-band-headline'] ?? tokens['--qb-band-ink'] ?? vars.foreground)),
        size: pxs(values.headline.size),
        weight: String(values.headline.weight),
        tracking: `${values.headline.size * values.headline.tracking}px`,
        case: design.brand.fonts.headlineCase === 'upper' ? 'uppercase' : 'none',
        leading: String(tune.headline?.leading ?? 1.1),
      }
    case 'heading':
      return {
        color: (!dark && tune.heading?.colour) || vars.foreground,
        size: pxs(values.heading.size),
        weight: String(values.heading.weight),
        tracking: `${(tune.heading?.tracking ?? 0) * values.heading.size}px`,
        case: 'none',
        leading: String(tune.heading?.leading ?? 1.3),
      }
    case 'subtitle':
      return {
        color:
          (!dark && tune.subtitle?.colour) ||
          (tokens['--qb-band-subtitle'] ?? tokens['--qb-band-muted'] ?? vars.mutedForeground),
        size: pxs(tune.subtitle?.size ?? 17),
        weight: String(tune.subtitle?.weight ?? 400),
      }
    case 'body':
      return {
        color: vars.foreground,
        size: pxs(tune.body?.size ?? 15),
        leading: String(tune.body?.leading ?? 1.6),
      }
    case 'input':
      return {
        background: vars.card,
        borderColor: vars.input || vars.border,
        borderWidth: '1px',
        radius: pxs(values.field.radius),
        shadow: 'none',
      }
    case 'vote':
      return {
        background: 'transparent',
        color: vars.foreground,
        borderColor: vars.input || vars.border,
        borderWidth: '1px',
        radius: pxs(values.button.radius),
        shadow: 'none',
      }
    case 'chip':
    case 'badge':
      return {
        background: vars.muted,
        color: vars.foreground,
        radius: '999px',
        borderColor: vars.border,
        borderWidth: '0px',
        case: 'none',
      }
    default:
      return {}
  }
}

/** What the portal itself draws in a state, before any style Ask AI wrote. */
function stateValues(
  design: PortalDesign,
  target: StyleTarget,
  vars: Required<ThemeVariables>,
  tokens: Record<string, string>
): Record<string, string> {
  const t = `${target.element}:${target.state}`
  const underline = design.tune?.link?.underline
  switch (t) {
    case 'link:hover':
      return underline === 'hover' || underline === 'always' ? { underline: 'underline' } : {}
    case 'nav-item:current':
      return {
        background: tokens['--qb-nav-active-bg'] ?? 'transparent',
        color: tokens['--qb-nav-active-ink'] ?? vars.foreground,
      }
    case 'vote-button:voted': {
      const ink = tokens['--qb-vote-active'] ?? vars.primary
      return { color: ink, borderColor: ink }
    }
    case 'field:focus':
      return { borderColor: vars.ring }
    default:
      return {}
  }
}

/**
 * A background's own colour: the value itself, or under layers drawn over
 * it (a glow), the last of them, where it is a colour.
 */
function baseLayer(background: string): string {
  if (parseCssColour(background)) return background
  const last = background.slice(background.lastIndexOf(')') + 1).replace(/^\s*,\s*/, '')
  return parseCssColour(last) ? last : background
}

/** The colour each element sits on. */
function behindOf(
  element: string,
  vars: Required<ThemeVariables>,
  design: PortalDesign,
  tokens: Record<string, string>
) {
  // A headline and its subtitle sit on the hero where there is one.
  if (
    ['headline', 'subtitle'].includes(element) &&
    design.layout.hero !== 'none' &&
    tokens['--qb-band-bg']
  )
    return baseLayer(tokens['--qb-band-bg'])
  if (['link', 'body', 'vote', 'chip', 'badge'].includes(element) && design.layout.cards !== 'list')
    return vars.card
  return vars.background
}

/**
 * The scopes of looks that reach a target, lowest first, by their tokens'
 * prefixes: the site's, then where the target names a place an override
 * went, that page's, its Home block's and its part's own, as the cascade
 * draws them. A place the design does not have reads as the site's look.
 */
function scopesOf(design: PortalDesign, target: StyleTarget, source: string): string[] {
  const scopes = ['']
  const byType = target.block
    ? design.pages.home.blocks.find((b) => b.type === target.block && b.id)?.id
    : undefined
  const place = placeOf(target)
  const where = place ? whereOf(design, place) : null
  const read = where?.ok ? where.read : null
  let page: OverridePage | undefined
  let block = byType
  let part: string | undefined
  if (read?.kind === 'page') page = read.page
  if (read?.kind === 'block') {
    page = 'home'
    block = read.block
  }
  if (read?.kind === 'part') {
    if (read.part.pages.length === 1) page = read.part.pages[0]
    block = read.part.block ?? block
    part = read.part.id
  }
  const overrides = design.overrides ?? []
  const index = (match: (o: (typeof overrides)[number]) => boolean) => overrides.findIndex(match)
  if (page) {
    const at = index(
      (o) => o.target.scope === 'page' && o.target.page === page && o.target.element === source
    )
    if (at >= 0) scopes.push(`g${at}-`)
  }
  if (block) scopes.push(`b${block}-`)
  if (part) {
    const at = index(
      (o) => o.target.scope === 'part' && o.target.part === part && o.target.element === source
    )
    if (at >= 0) scopes.push(`p${at}-`)
  }
  return scopes
}

/**
 * Reads targets from the design: each element's values at rest, then the
 * style rules Ask AI wrote for it, at rest and in its state: the site's,
 * then, narrower, the place an override went (its page, its block, its
 * part), or one block's own.
 */
export function staticReadings(
  design: PortalDesign,
  registry: StyleRegistry,
  targets: readonly StyleTarget[]
): Readings {
  const resolved = resolveDesign(design)
  const mode = shownMode(design)
  const vars = ((mode === 'dark' ? resolved.dark : resolved.light) ??
    resolved.light ??
    resolved.dark ??
    {}) as Required<ThemeVariables>
  const tokens: Record<string, string> =
    mode === 'dark' ? resolved.tokens.dark : resolved.tokens.light
  const out: Readings = {}
  for (const target of targets) {
    const element = elementOf(registry, target.element)
    if (!element || !element.states.includes(target.state)) {
      out[targetKey(target)] = { found: false, values: {}, behind: null }
      continue
    }
    const values = {
      ...baseValues(design, target.element, vars, tokens),
      ...stateValues(design, target, vars, tokens),
    }
    // The element styles drawn for it: the site's, then one block's own, at rest and in the state.
    // The site's panel styles reach Home's blocks drawn as cards.
    const sources = target.element === 'block' ? ['panel', 'block'] : [target.element]
    const states = target.state === 'base' ? ['base'] : ['base', target.state]
    for (const state of states)
      for (const source of sources)
        for (const scope of scopesOf(design, target, source)) {
          if (scope && source === 'panel' && target.element === 'block') continue
          for (const prop of Object.keys(values).concat(TOKEN_PROPS)) {
            const value = tokens[`--qb-st-${scope}${source}-${state}-${prop}`]
            if (value !== undefined) values[prop] = readingOf(prop as StyleProp, value, values)
          }
        }
    for (const property of ['background', 'color', 'borderColor']) {
      if (values[property])
        values[property] =
          values[property] === 'transparent' ? 'transparent' : hex(values[property])
    }
    const reading: ElementReading = {
      found: true,
      values,
      behind: hex(behindOf(target.element, vars, design, tokens)),
    }
    out[targetKey(target)] = reading
  }
  return out
}

/** One target's reading from the design. */
export const staticReading = (
  design: PortalDesign,
  registry: StyleRegistry,
  target: StyleTarget
): ElementReading => staticReadings(design, registry, [target])[targetKey(target)]!
