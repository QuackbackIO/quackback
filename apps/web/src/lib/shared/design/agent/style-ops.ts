/**
 * The adapter from styles (element, state, property, value) to the design's
 * operations, over the style token registry (../style-tokens.ts). A style
 * the design already has an exact value for, at rest and for the whole
 * portal, goes to that field (button fill to tune.button.fill, card shadow
 * to tune.card.shadow), so the builder's panels show it as before; any other
 * (a state, one Home block, a property no exact value has) becomes a token:
 * style.<element>.<state>.<property>, or the Home blocks' own look.style.
 * Values are checked against the registry's ranges first; relative colours
 * ("darker", "lighter 15%") are worked out from what the element shows now,
 * and a role stays a role so dark mode follows by itself.
 */
import { mixColor, normaliseColor } from '../color'
import { resolveDesign } from '../resolve'
import type { PortalDesign } from '../schema'
import type { DesignAiScope } from '../apply-changes'
import {
  applyOps,
  blockTypeOf,
  type FlatOp,
  type OpScope,
  type OpWorld,
  type OpsOutcome,
} from '../design-ops'
import type { AppliedDesignChange, DesignValue } from '../apply-changes'
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { lightness, parseCssColour } from './css-values'
import { shownMode, staticReading } from './static-reading'
import { BLOCK_STYLE_ELEMENTS, COLOUR_ROLES, readStyleValue, type StyleProp } from '../style-tokens'
import {
  elementOf,
  propertyOf,
  targetWords,
  type StyleRegistry,
  type StyleStateId,
  type StyleTarget,
} from './style-registry'
import { LIGHTNESS_STEP } from './verify'

/** One style as the model writes it. */
export interface StyleOp extends StyleTarget {
  property: string
  value: string
  /** What it does, in words that follow "I changed". */
  says?: string
}

/** A style worked out: the operations that set it (an exact value, or tokens), and their path. */
type Planned = { kind: 'field' | 'token'; ops: FlatOp[]; path: string; label: string }

/** The exact values a style at rest reaches, by element and property. */
const FIELDS: Record<string, Record<string, string>> = {
  button: {
    background: 'button.fill',
    color: 'button.ink',
    radius: 'button.radius',
    height: 'button.height',
    weight: 'button.weight',
    case: 'button.case',
  },
  card: { radius: 'card.radius', borderWidth: 'card.border', shadow: 'card.shadow' },
  headline: {
    size: 'headline.size',
    weight: 'headline.weight',
    tracking: 'headline.tracking',
    leading: 'headline.leading',
    color: 'headline.colour',
  },
  heading: {
    size: 'heading.size',
    weight: 'heading.weight',
    tracking: 'heading.tracking',
    leading: 'heading.leading',
    color: 'heading.colour',
  },
  subtitle: { size: 'subtitle.size', weight: 'subtitle.weight', color: 'subtitle.colour' },
  link: { color: 'link.colour', weight: 'link.weight', underline: 'link.underline' },
  body: { size: 'body.size', leading: 'body.leading' },
  input: { radius: 'field.radius' },
  page: { background: 'background', color: 'text' },
}

/** Ranges the exact values keep, narrower than the tokens'; a value beyond is a token. */
const FIELD_RANGES: Record<string, [number, number]> = {
  'card.radius': [0, 48],
  'card.border': [0, 4],
  'subtitle.size': [12, 32],
  'body.size': [12, 20],
  'body.leading': [1.2, 2],
}

/** Shadows an exact card shadow takes. */
const CARD_SHADOWS = ['none', 'soft', 'lifted', 'floating', 'deep']

const WEIGHTS: Record<string, number> = {
  thin: 100,
  light: 300,
  regular: 400,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,
}

/** Words for a choice, as people and CSS write them, to the registry's value. */
const CHOICE_ALIASES: Record<string, string> = {
  uppercase: 'upper',
  caps: 'upper',
  capitals: 'upper',
  'all caps': 'upper',
  lowercase: 'lower',
  sentence: 'none',
  underlined: 'underline',
  always: 'underline',
  subtle: 'soft',
  strong: 'deep',
}

const ROLES = ['accent', 'text', 'page', 'surface', 'border', 'muted', 'support'] as const
/** A role the loop names, as the token registry names it. */
const TOKEN_ROLE: Record<string, string> = { text: 'ink' }

/** A role's colour as the design shows it, or null for a word that is no role. */
export function roleColour(design: PortalDesign, role: string): string | null {
  if (!(ROLES as readonly string[]).includes(role)) return null
  const resolved = resolveDesign(design)
  const vars = ((shownMode(design) === 'dark' ? resolved.dark : resolved.light) ??
    resolved.light ??
    {}) as Required<ThemeVariables>
  const pick: Record<(typeof ROLES)[number], string | undefined> = {
    accent: vars.primary,
    text: vars.foreground,
    page: vars.background,
    surface: vars.card,
    border: vars.border,
    muted: vars.mutedForeground,
    support: design.brand.light.support ?? undefined,
  }
  const value = pick[role as (typeof ROLES)[number]]
  return value ? (parseCssColour(value)?.hex ?? null) : null
}

/**
 * A colour as written, worked out: hex and the CSS forms, a role, or a step
 * darker or lighter than what the element shows at rest, at least a step the
 * eye sees.
 */
export function styleColour(
  design: PortalDesign,
  registry: StyleRegistry,
  style: StyleOp
): { ok: true; hex: string; how: string; role?: string } | { ok: false; refusal: string } {
  const text = style.value.trim().toLowerCase()
  const relative = /^(darker|lighter)(?:\s+(?:by\s+)?(\d{1,2})\s*%?)?$/.exec(text)
  if (relative) {
    const base = staticReading(design, registry, { ...style, state: 'base' })
    const from = parseCssColour(base.values[style.property])
    if (!from || from.alpha === 0)
      return {
        ok: false,
        refusal: `${targetWords(registry, { ...style, state: 'base' })} has no ${style.property} to make ${relative[1]}; give a colour`,
      }
    const toward = relative[1] === 'darker' ? '#000000' : '#ffffff'
    let share = (relative[2] ? Number(relative[2]) : 12) / 100
    let next = mixColor(toward, from.hex, share)
    // At least a step the eye sees, however small the share asked.
    while (Math.abs(lightness(next) - lightness(from.hex)) < LIGHTNESS_STEP + 0.01 && share < 0.6) {
      share += 0.04
      next = mixColor(toward, from.hex, share)
    }
    if (Math.abs(lightness(next) - lightness(from.hex)) < LIGHTNESS_STEP)
      return {
        ok: false,
        refusal: `${targetWords(registry, { ...style, state: 'base' })} ${style.property} is ${from.hex}, already as ${relative[1] === 'darker' ? 'dark' : 'light'} as a colour goes; give a colour`,
      }
    return { ok: true, hex: next, how: `${relative[1]} (${from.hex} → ${next})` }
  }
  const role = TOKEN_ROLE[text] ?? text
  if (
    (ROLES as readonly string[]).includes(text) ||
    (COLOUR_ROLES as readonly string[]).includes(role)
  ) {
    const hex = roleColour(design, text) ?? roleColour(design, text === 'ink' ? 'text' : text)
    if ((COLOUR_ROLES as readonly string[]).includes(role))
      return { ok: true, hex: hex ?? '#000000', how: `the ${text} colour`, role }
    return hex
      ? { ok: true, hex, how: `the ${text} colour` }
      : { ok: false, refusal: `the design has no ${text} colour` }
  }
  const hex = normaliseColor(text)
  const parsed = hex ? parseCssColour(hex) : null
  if (!parsed)
    return {
      ok: false,
      refusal: `“${style.value}” is not a colour; give hex such as #1f2937, darker, lighter or a role (${ROLES.join(', ')})`,
    }
  return { ok: true, hex: parsed.hex, how: parsed.hex }
}

/** A number within the property's range, from "12", "12px", "0.02em", "bold". */
function styleNumber(
  registry: StyleRegistry,
  style: StyleOp
): { ok: true; n: number } | { ok: false; refusal: string } {
  const property = propertyOf(registry, style.property)!
  const text = style.value.trim().toLowerCase()
  const n = property.kind === 'weight' && WEIGHTS[text] ? WEIGHTS[text]! : parseFloat(text)
  if (Number.isNaN(n))
    return { ok: false, refusal: `${style.property} takes a number, not “${style.value}”` }
  if (n < property.min! || n > property.max!)
    return {
      ok: false,
      refusal: `${style.property} can be ${property.min} to ${property.max}${property.kind === 'px' ? 'px' : property.kind === 'em' ? 'em' : ''}`,
    }
  return { ok: true, n }
}

/** Works out one style: what it sets, or why not. */
export function planStyle(
  design: PortalDesign,
  registry: StyleRegistry,
  style: StyleOp
): { ok: true; plan: Planned } | { ok: false; refusal: string } {
  const element = elementOf(registry, style.element)
  if (!element)
    return {
      ok: false,
      refusal: `there is no element ${style.element}; there are ${registry.elements.map((e) => e.id).join(', ')}`,
    }
  const state = (style.state || 'base') as StyleStateId
  if (!element.states.includes(state))
    return {
      ok: false,
      refusal: `${element.name} have no ${state} state; they have ${element.states.join(', ')}`,
    }
  const property = propertyOf(registry, style.property)
  if (!property || !element.properties.includes(property.id))
    return {
      ok: false,
      refusal: `${element.name} cannot take ${style.property}; they take ${element.properties.join(', ')}`,
    }
  let block = ''
  if (style.block.trim()) {
    const type = blockTypeOf(style.block)
    if (!type || !design.pages.home.blocks.some((b) => b.type === type))
      return { ok: false, refusal: `Home has no ${style.block} block to style` }
    block = type
  }
  const target: StyleTarget = { element: element.id, state, block }
  const words = targetWords(registry, target)

  // The value, checked, as the token takes it and as an exact value would.
  let tokenValue: unknown
  let shownValue: string
  let fieldValue: unknown
  switch (property.kind) {
    case 'colour': {
      const colour = styleColour(design, registry, { ...style, ...target })
      if (!colour.ok) return colour
      tokenValue = colour.role ?? colour.hex
      shownValue = colour.how
      fieldValue = colour.role ? null : colour.hex
      break
    }
    case 'shadow':
    case 'choice': {
      const text = style.value.trim().toLowerCase()
      const value = property.choices!.includes(text) ? text : (CHOICE_ALIASES[text] ?? text)
      if (!property.choices!.includes(value))
        return { ok: false, refusal: `${property.id} can be ${property.choices!.join(', ')}` }
      tokenValue = value
      shownValue = value
      fieldValue =
        property.id === 'case'
          ? value === 'upper'
            ? 'upper'
            : value === 'none'
              ? 'sentence'
              : null
          : property.id === 'underline'
            ? value === 'underline'
              ? 'always'
              : 'never'
            : property.id === 'shadow'
              ? CARD_SHADOWS.includes(value)
                ? value
                : null
              : null
      break
    }
    default: {
      const n = styleNumber(registry, style)
      if (!n.ok) return n
      const unit = property.kind === 'px' ? 'px' : property.kind === 'em' ? 'em' : ''
      tokenValue = n.n
      shownValue = `${n.n}${unit}`
      fieldValue = n.n
    }
  }
  const label = `${words}: ${property.id} ${shownValue}`

  // An exact value where the design has one, at rest, for the whole portal, in the mode it reaches.
  const fieldKey = FIELDS[element.id]?.[property.id]
  const lightOnly = property.kind === 'colour' && element.id !== 'page'
  const reachable =
    state === 'base' &&
    !block &&
    fieldKey &&
    fieldValue !== null &&
    !(lightOnly && shownMode(design) === 'dark') &&
    !(
      FIELD_RANGES[fieldKey] &&
      typeof fieldValue === 'number' &&
      (fieldValue < FIELD_RANGES[fieldKey][0] || fieldValue > FIELD_RANGES[fieldKey][1])
    )
  if (element.id === 'page') {
    if (!reachable) return { ok: false, refusal: 'the page takes its colours from Theme alone' }
  }
  if (reachable) {
    const key =
      element.id === 'page' && shownMode(design) === 'dark'
        ? fieldKey === 'background'
          ? 'darkBackground'
          : 'darkText'
        : fieldKey
    const path = key.includes('.')
      ? `tune.${key}`
      : key === 'background'
        ? 'brand.light.background'
        : key === 'text'
          ? 'brand.light.ink'
          : key === 'darkBackground'
            ? 'brand.dark.background'
            : 'brand.dark.ink'
    return {
      ok: true,
      plan: {
        kind: 'field',
        ops: [{ op: 'theme', key, value: JSON.stringify(fieldValue) }],
        path,
        label,
      },
    }
  }
  // A token: the whole portal's, or each Home block of the type named.
  const value = JSON.stringify(readStyleValue(property.id as StyleProp, tokenValue))
  const key = `style.${element.id}.${state}.${property.id}`
  if (!block)
    return {
      ok: true,
      plan: { kind: 'token', ops: [{ op: 'theme', key, value }], path: key, label },
    }
  const own =
    element.id === 'block' || (BLOCK_STYLE_ELEMENTS as readonly string[]).includes(element.id)
  if (!own)
    return {
      ok: false,
      refusal: `${element.name} in one block cannot be styled apart; a block's own look reaches ${BLOCK_STYLE_ELEMENTS.join(', ')}`,
    }
  const ids = design.pages.home.blocks.filter((b) => b.type === block && b.id).map((b) => b.id!)
  return {
    ok: true,
    plan: {
      kind: 'token',
      ops: ids.map((id) => ({ op: 'set', target: id, key, value })),
      path: 'pages.home.blocks',
      label,
    },
  }
}

export interface StyleOutcome {
  /** The operations the styles became: exact values and tokens. */
  ops: FlatOp[]
  /** Each style that was planned, with its label, the field it set and its operations. */
  planned: Array<{ style: StyleOp; label: string; path: string; ops: FlatOp[] }>
  refused: Array<{ style: StyleOp; reason: string }>
}

/** Styles as the design's operations. */
export function stylesAsOps(
  design: PortalDesign,
  registry: StyleRegistry,
  styles: readonly StyleOp[]
): StyleOutcome {
  const out: StyleOutcome = { ops: [], planned: [], refused: [] }
  for (const style of styles) {
    const planned = planStyle(design, registry, style)
    if (!planned.ok) {
      out.refused.push({ style, reason: planned.refusal })
      continue
    }
    out.ops.push(...planned.plan.ops)
    out.planned.push({
      style,
      label: planned.plan.label,
      path: planned.plan.path,
      ops: planned.plan.ops,
    })
  }
  return out
}

/** The elements a picked part's styles may reach; every one for the whole site and brand. */
const SCOPE_ELEMENTS: Partial<Record<DesignAiScope, readonly string[]>> = {
  header: ['header', 'navItem'],
  band: ['hero', 'headline', 'subtitle', 'button'],
  headline: ['headline'],
  subtitle: ['subtitle'],
  heading: ['heading'],
  menu: ['navItem'],
  button: ['button'],
  secondary: ['secondary', 'ghost'],
  card: ['card'],
  vote: ['vote'],
  field: ['input'],
  status: ['badge', 'chip'],
  link: ['link'],
  body: ['body'],
  feed: ['card', 'vote', 'chip', 'badge'],
  home: [
    'block',
    'card',
    'heading',
    'link',
    'button',
    'body',
    'chip',
    'badge',
    'vote',
    'input',
    'secondary',
    'ghost',
  ],
}

/** Whether a style stays within what was picked. */
export function styleInScope(style: StyleOp, within: OpScope, design: PortalDesign): boolean {
  if (within.scope === 'site' || within.scope === 'brand') return true
  const allowed = SCOPE_ELEMENTS[within.scope]
  if (!allowed?.includes(style.element)) return false
  if (within.blockId) {
    const picked = design.pages.home.blocks.find((b) => b.id === within.blockId)
    return !!picked && blockTypeOf(style.block) === picked.type
  }
  return true
}

const read = (doc: unknown, path: string): DesignValue =>
  (path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      doc
    ) ?? null) as DesignValue

const under = (path: string, field: string) => path === field || path.startsWith(`${field}.`)
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Changes from several applications as one list, each field once: its value
 * before the first and after the last, its labels joined. A field inside one
 * already listed joins it; a field changed and changed back drops out.
 */
export function mergeChanges(
  original: PortalDesign,
  final: PortalDesign,
  lists: ReadonlyArray<readonly AppliedDesignChange[]>
): AppliedDesignChange[] {
  const labels = new Map<string, string[]>()
  for (const change of lists.flat()) {
    const ancestor = [...labels.keys()].find((path) => under(change.path, path))
    const own = (change.label ?? '').split('; ').filter(Boolean)
    if (ancestor) {
      labels.set(ancestor, [...new Set([...labels.get(ancestor)!, ...own])])
      continue
    }
    const inside = [...labels.keys()].filter((path) => under(path, change.path))
    const joined = [...new Set([...inside.flatMap((path) => labels.get(path)!), ...own])]
    for (const path of inside) labels.delete(path)
    labels.set(change.path, joined)
  }
  return [...labels.entries()].flatMap(([path, names]) => {
    const before = structuredClone(read(original, path))
    const after = structuredClone(read(final, path))
    if (same(before, after)) return []
    return [{ path, before, after, ...(names.length ? { label: names.join('; ') } : {}) }]
  })
}

/** What a loop step's operations and styles did. */
export interface LoopApplyOutcome {
  design: PortalDesign
  applied: AppliedDesignChange[]
  done: string[]
  already: string[]
  refused: Array<{ what: string; reason: string }>
  outOfScope: string[]
}

const opWords = (op: FlatOp) =>
  [op.op, op.target, op.key, op.value].filter((part) => part !== undefined && part !== '').join(' ')

/**
 * Applies a step's operations, then its styles on the design they left (so
 * a style reads the mode and colours the operations set), each checked as
 * Ask AI's operations are. Styles' changes carry their own labels.
 */
export function applyStep(
  design: PortalDesign,
  world: OpWorld,
  registry: StyleRegistry,
  ops: readonly FlatOp[],
  styles: readonly StyleOp[],
  within: OpScope = { scope: 'site' }
): LoopApplyOutcome {
  const first: OpsOutcome = applyOps(design, world, ops, within)
  const scoped = styles.filter((style) => styleInScope(style, within, first.design))
  const outOfScope = [
    ...first.outOfScope.map(opWords),
    ...styles.filter((s) => !scoped.includes(s)).map((s) => targetWords(registry, s)),
  ]
  const asOps = stylesAsOps(first.design, registry, scoped)
  const second = applyOps(first.design, world, asOps.ops)
  const styleLabels = new Map<string, string[]>()
  const done: string[] = first.done.map((each) => each.label)
  const refused = [
    ...first.refused.map((each) => ({ what: opWords(each.op), reason: each.reason })),
    ...asOps.refused.map((each) => ({
      what: targetWords(registry, each.style),
      reason: each.reason,
    })),
  ]
  for (const planned of asOps.planned) {
    const failed = second.refused.find((each) => planned.ops.includes(each.op))
    if (failed) {
      refused.push({ what: planned.label, reason: failed.reason })
      continue
    }
    done.push(planned.label)
    styleLabels.set(planned.path, [...(styleLabels.get(planned.path) ?? []), planned.label])
  }
  const relabelled = second.applied.map((change) => {
    // Every style this change holds: one token, or a whole sheet written at once.
    const own = [...styleLabels.entries()]
      .filter(([path]) => under(path, change.path) || under(change.path, path))
      .flatMap(([, labels]) => labels)
    return own.length ? { ...change, label: own.join('; ') } : change
  })
  return {
    design: second.design,
    applied: mergeChanges(design, second.design, [first.applied, relabelled]),
    done,
    already: [...first.already, ...second.already].map((each) => each.label),
    refused,
    outOfScope,
  }
}
