/**
 * Element overrides: an element's look set for one page, or for one part of
 * the portal ("this one"), over the site's `style`. Each override names its
 * target (a page and an element kind, or a part and the element kind it is),
 * and holds the same looks `style` does: states and their properties, dark
 * mode's own colours, and phones' own sizes.
 *
 * The cascade, lowest first: the theme, tune, `style` (everywhere), a page
 * override, a Home block's `look.style`, a part override, the workspace's
 * CSS. Phone values sit in the same layer as the values they refine, under
 * the phone breakpoint.
 *
 * An override is addressed by path as `style` is,
 * `overrides.<id>.<style|styleDark|phone>.<state>.<prop>`, where the id is
 * written from the target, so the same target always has the same id.
 *
 * Pure: zod and the style registry only.
 */
import { z } from 'zod'
import { DESIGN_OPTIONS } from './options'
import {
  COLOUR_PROPS,
  PHONE_PROPS,
  STYLE_ELEMENT_NAMES,
  STYLE_ELEMENTS,
  elementStyleSchema,
  styleAllows,
  type ElementStyle,
  type StyleElement,
  type StyleProp,
  type StyleState,
} from './style-tokens'

export const MAX_OVERRIDES = 200

export type OverridePage = (typeof DESIGN_OPTIONS.backgroundPage)[number]

/** A part's name, as the parts registry writes it: `hero.home.cta`, `block.<id>.heading`. */
export const PART_ID = /^[a-z][a-z0-9_-]*(\.[a-z0-9_:-]+){0,3}$/i

export type OverrideTarget =
  | { scope: 'page'; page: OverridePage; element: StyleElement }
  | { scope: 'part'; part: string; element: StyleElement }

/** What an override sets: its looks by state, dark mode's colours and phones' sizes. */
export type OverrideLayer = 'style' | 'styleDark' | 'phone'

export interface StyleOverride {
  id: string
  target: OverrideTarget
  style?: ElementStyle
  styleDark?: ElementStyle
  phone?: ElementStyle
}

const element = z.enum(STYLE_ELEMENT_NAMES as [StyleElement, ...StyleElement[]])
const target = z.discriminatedUnion('scope', [
  z
    .object({ scope: z.literal('page'), page: z.enum(DESIGN_OPTIONS.backgroundPage), element })
    .strict(),
  z.object({ scope: z.literal('part'), part: z.string().max(96).regex(PART_ID), element }).strict(),
])

/** An override's id, written from its target. */
export function overrideIdOf(t: OverrideTarget): string {
  return t.scope === 'page' ? `page:${t.page}:${t.element}` : `part:${t.part}:${t.element}`
}

/** The properties each layer may hold. */
export const LAYER_PROPS: Record<OverrideLayer, readonly StyleProp[] | undefined> = {
  style: undefined,
  styleDark: COLOUR_PROPS,
  phone: PHONE_PROPS,
}

/** A look with its empty states left out; undefined when nothing is left. */
function trimmed(style: ElementStyle | undefined): ElementStyle | undefined {
  if (!style) return undefined
  const out: ElementStyle = {}
  for (const [state, props] of Object.entries(style) as Array<[StyleState, object | undefined]>)
    if (props && Object.keys(props).length) out[state] = props
  return Object.keys(out).length ? out : undefined
}

const override = z
  .object({
    id: z.string().max(128),
    target,
    style: z.unknown().optional(),
    styleDark: z.unknown().optional(),
    phone: z.unknown().optional(),
  })
  .strict()
  .transform((o, ctx) => {
    const out: StyleOverride = { id: overrideIdOf(o.target), target: o.target }
    for (const layer of ['style', 'styleDark', 'phone'] as const) {
      if (o[layer] === undefined) continue
      const parsed = elementStyleSchema(o.target.element, LAYER_PROPS[layer]).safeParse(o[layer])
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          ctx.addIssue({ ...issue, path: [layer, ...issue.path] } as never)
        return z.NEVER
      }
      const kept = trimmed(parsed.data)
      if (kept) out[layer] = kept
    }
    return out
  })

/**
 * `design.overrides`: at most 200, one per target, each written from the
 * registry; empty states and empty overrides are left out.
 */
export const overridesSchema = z
  .array(override)
  .max(MAX_OVERRIDES)
  .superRefine((list, ctx) => {
    const seen = new Set<string>()
    list.forEach((o, i) => {
      if (seen.has(o.id))
        ctx.addIssue({ code: 'custom', message: `Two overrides for ${o.id}`, path: [i, 'target'] })
      seen.add(o.id)
    })
  })
  .transform((list) => list.filter((o) => o.style || o.styleDark || o.phone))

/* Reading and writing */

interface WithOverrides {
  overrides?: StyleOverride[]
}

export function findOverride(
  design: WithOverrides,
  t: OverrideTarget | string
): StyleOverride | undefined {
  const id = typeof t === 'string' ? t : overrideIdOf(t)
  return design.overrides?.find((o) => o.id === id)
}

/**
 * Sets one value of an override in a draft, making the override where it is
 * missing and dropping what is left empty; undefined clears it. Refuses a
 * property the element does not have in that state, or a layer cannot hold.
 */
export function setOverrideValue(
  draft: WithOverrides,
  t: OverrideTarget,
  layer: OverrideLayer,
  state: StyleState,
  prop: StyleProp,
  value: unknown
): boolean {
  if (!styleAllows(t.element, state, prop)) return false
  const only = LAYER_PROPS[layer]
  if (only && !only.includes(prop)) return false
  const id = overrideIdOf(t)
  const list = (draft.overrides ??= [])
  let entry = list.find((o) => o.id === id)
  if (value === undefined) {
    if (!entry) return true
  } else if (!entry) {
    if (list.length >= MAX_OVERRIDES) return false
    entry = { id, target: { ...t } }
    list.push(entry)
  }
  const look = (entry![layer] ??= {}) as Record<string, Record<string, unknown>>
  const props = (look[state] ??= {})
  if (value === undefined) delete props[prop]
  else props[prop] = value
  if (!Object.keys(props).length) delete look[state]
  if (!Object.keys(look).length) delete entry![layer]
  if (!entry!.style && !entry!.styleDark && !entry!.phone) list.splice(list.indexOf(entry!), 1)
  if (!list.length) delete draft.overrides
  return true
}

/** Clears an override's states, or all of it, in a draft. */
export function clearOverride(draft: WithOverrides, t: OverrideTarget | string): void {
  const id = typeof t === 'string' ? t : overrideIdOf(t)
  if (!draft.overrides) return
  draft.overrides = draft.overrides.filter((o) => o.id !== id)
  if (!draft.overrides.length) delete draft.overrides
}

/** How many values an override sets, across its layers and states. */
export function overrideCount(o: StyleOverride): number {
  return (['style', 'styleDark', 'phone'] as const).reduce(
    (n, layer) =>
      n +
      Object.values(o[layer] ?? {}).reduce((m, props) => m + Object.keys(props ?? {}).length, 0),
    0
  )
}

/** An override's values as paths, for lists and summaries. */
export function overridePaths(o: StyleOverride): string[] {
  return (['style', 'styleDark', 'phone'] as const).flatMap((layer) =>
    Object.entries(o[layer] ?? {}).flatMap(([state, props]) =>
      Object.keys(props ?? {}).map((prop) => `overrides.${o.id}.${layer}.${state}.${prop}`)
    )
  )
}

/**
 * An override's key as people and the AI write it, to its parts:
 * `overrides.<id>.<style|styleDark|phone>.<state>.<prop>`. Null for no such value.
 */
export function overridePath(key: string): {
  id: string
  target: OverrideTarget
  layer: OverrideLayer
  state: StyleState
  prop: StyleProp
} | null {
  const m = /^overrides\.(.+)\.(style|styleDark|phone)\.(\w+)\.(\w+)$/.exec(key)
  if (!m) return null
  const t = targetOfId(m[1]!)
  if (!t) return null
  const [layer, state, prop] = [m[2] as OverrideLayer, m[3] as StyleState, m[4] as StyleProp]
  if (!styleAllows(t.element, state, prop)) return null
  const only = LAYER_PROPS[layer]
  if (only && !only.includes(prop)) return null
  return { id: m[1]!, target: t, layer, state, prop }
}

/** An override's target, read back from its id. */
export function targetOfId(id: string): OverrideTarget | null {
  const m = /^(page|part):(.+):(\w+)$/.exec(id)
  if (!m || !(m[3]! in STYLE_ELEMENTS)) return null
  const el = m[3] as StyleElement
  if (m[1] === 'page')
    return (DESIGN_OPTIONS.backgroundPage as readonly string[]).includes(m[2]!)
      ? { scope: 'page', page: m[2] as OverridePage, element: el }
      : null
  return PART_ID.test(m[2]!) ? { scope: 'part', part: m[2]!, element: el } : null
}
