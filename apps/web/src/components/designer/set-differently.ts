/**
 * The one list of places an element's look is set differently from every
 * one of its kind: page and part overrides, and Home blocks' own looks.
 * Each says what it sets, with its values, and which values are a state's,
 * phones' or dark mode's own. Theme's list shows every place; an element
 * panel's footer shows its own, in the same words.
 */
import {
  alsoSetAt,
  orphanedOverrides,
  overrideName,
  type AlsoSet,
} from '@/lib/shared/design/override-cascade'
import { partOf } from '@/lib/shared/design/parts-registry'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { findOverride, type StyleOverride } from '@/lib/shared/design/style-overrides'
import {
  COLOUR_ROLE_INFO,
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  STYLE_PROP_NAMES,
  STYLE_STATES,
  type ColourRoleName,
  type ElementStyle,
  type StyleElement,
  type StyleProp,
  type StylePropInfo,
  type StyleSheet,
} from '@/lib/shared/design/style-tokens'
import { CHOICE_TILES, COLOUR_NAMES } from './properties/words'

/** A value as the panel says it: "16 px", "Brand colour", "Gradient". */
export function valueText(prop: StyleProp, value: unknown): string {
  const info: StylePropInfo = STYLE_PROPS[prop]
  if (typeof value === 'object' && value) return 'Gradient'
  if (info.kind === 'number') return `${value as number}${info.unit ? ` ${info.unit}` : ''}`
  if (info.kind === 'choice')
    return (
      (CHOICE_TILES as Record<string, Record<string, string>>)[prop]?.[value as string] ??
      (info.looks as Record<string, string>)[value as string] ??
      String(value)
    )
  if (typeof value === 'string' && value in COLOUR_ROLE_INFO)
    return COLOUR_NAMES[value as ColourRoleName]
  return String(value)
}

/** A look's layers: every screen's, phones' own and dark mode's own. */
export interface LookLayers {
  style?: ElementStyle
  phone?: ElementStyle
  dark?: ElementStyle
}

/**
 * What a look sets, as a short list: "corners 4 px, background Second
 * colour (hover), size 18 px (phone)". Every screen's first, then phones',
 * then dark mode's; in each, by state, then in the registry's order.
 */
export function lookDetail(_element: StyleElement, layers: LookLayers): string {
  const out: string[] = []
  for (const [layer, tag] of [
    ['style', ''],
    ['phone', 'phone'],
    ['dark', 'dark'],
  ] as const)
    for (const state of STYLE_STATES) {
      const props = layers[layer]?.[state] as Record<string, unknown> | undefined
      if (!props) continue
      for (const prop of STYLE_PROP_NAMES) {
        if (props[prop] === undefined) continue
        const tags = [state === 'base' ? '' : STATE_INFO[state].label.toLowerCase(), tag].filter(
          Boolean
        )
        out.push(
          `${STYLE_PROPS[prop].label.toLowerCase()} ${valueText(prop, props[prop])}${
            tags.length ? ` (${tags.join(', ')})` : ''
          }`
        )
      }
    }
  return out.join(', ')
}

const blockOf = (design: PortalDesign, id: string | undefined) =>
  design.pages.home.blocks.find((b) => b.id === id)

/** A Home block's own look of an element, in its layers. */
function blockLayers(design: PortalDesign, block: string | undefined, element: StyleElement) {
  const look = blockOf(design, block)?.look
  return {
    style: (look?.style as StyleSheet | undefined)?.[element],
    phone: (look?.phone as StyleSheet | undefined)?.[element],
  }
}

/** What a place an element is set differently holds, as the panel's footer and Theme say it. */
export function placeDetail(design: PortalDesign, element: StyleElement, place: AlsoSet): string {
  if (place.scope === 'block') return lookDetail(element, blockLayers(design, place.block, element))
  const o =
    place.scope === 'page' && place.page
      ? findOverride(design, { scope: 'page', page: place.page, element })
      : place.part
        ? findOverride(design, { scope: 'part', part: place.part, element })
        : undefined
  return lookDetail(element, overrideLayers(o))
}

const overrideLayers = (o: StyleOverride | undefined): LookLayers => ({
  style: o?.style,
  phone: o?.phone,
  dark: o?.styleDark,
})

/** A place an element's look is set differently, as Theme lists it. */
export interface SetPlace {
  key: string
  element: StyleElement
  /** What it is grouped under: its page, the place its part is in, or its block. */
  group: string
  /** "Call to action · Hero", "Main buttons on Changelog", "Links in Top posts". */
  name: string
  detail: string
  /** The place, to reset it or go to it. */
  place: AlsoSet
  /** The override it is, where it is one. */
  override?: StyleOverride
  /** Its part is gone, so nothing draws it. */
  orphan: boolean
}

const GONE = 'Gone from the portal'

/** Every place a look is set differently: overrides first, in their order, then each block's. */
export function setDifferently(design: PortalDesign): SetPlace[] {
  const orphans = new Set(orphanedOverrides(design).map((o) => o.id))
  const out: SetPlace[] = []
  for (const o of design.overrides ?? []) {
    const element = o.target.element
    const part = o.target.scope === 'part' ? partOf(design, o.target.part) : null
    const page = o.target.scope === 'page' ? o.target.page : null
    const place: AlsoSet = page
      ? (alsoSetAt(design, { element, part: null, page: null, block: null }, 'everywhere').find(
          (p) => p.scope === 'page' && p.page === page
        ) ?? { scope: 'page', label: page, page })
      : {
          scope: 'part',
          label: part
            ? `${part.label} · ${part.group.replace(/ · .*$/, '')}`
            : overrideName(design, o),
          part: (o.target as { part: string }).part,
        }
    out.push({
      key: o.id,
      element,
      group: o.target.scope === 'page' ? place.label : part ? part.group : GONE,
      name: overrideName(design, o),
      detail: lookDetail(element, overrideLayers(o)),
      place,
      override: o,
      orphan: orphans.has(o.id),
    })
  }
  for (const block of design.pages.home.blocks) {
    if (!block.id || !block.look) continue
    const elements = new Set([
      ...Object.keys((block.look.style as StyleSheet | undefined) ?? {}),
      ...Object.keys((block.look.phone as StyleSheet | undefined) ?? {}),
    ]) as Set<StyleElement>
    for (const element of Object.keys(STYLE_ELEMENTS) as StyleElement[]) {
      if (!elements.has(element)) continue
      const place = blockPlace(design, element, block.id)
      if (!place) continue
      out.push({
        key: `block:${block.id}:${element}`,
        element,
        group: place.label,
        name: `${STYLE_ELEMENTS[element].label} in ${place.label}`,
        detail: lookDetail(element, blockLayers(design, block.id, element)),
        place,
        orphan: false,
      })
    }
  }
  return out
}

/** A block's place, named as the cascade names it. */
function blockPlace(design: PortalDesign, element: StyleElement, block: string) {
  return alsoSetAt(design, { element, part: null, page: 'home', block: null }, 'everywhere').find(
    (p) => p.scope === 'block' && p.block === block
  )
}
