/**
 * Element styles as CSS: one resolver for every element kind, state and
 * Home block the registry (style-tokens.ts) describes. Each value a design
 * sets becomes a variable per mode (`--qb-st-...`), named colours drawn as
 * that mode's own, and one rule per element and state reads the variables,
 * so light and dark differ only in the variables.
 *
 * Text stays readable: wherever a state's text sits on a fill (its own, or
 * one it draws from its normal look), the text is moved in lightness until
 * it reads (4.5:1, a headline set large everywhere 3:1), and a fill set without text takes the
 * design's text or page colour, whichever reads, or where both sides of
 * light read, the one that reads clearer. Hover and pressed fills,
 * when left out, are drawn from a set normal fill: a little darker, or
 * lighter on a dark fill.
 */
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { fitted, lchOf, mixColor, oklabDistance } from './color'
import { SHADOW } from './tune'
import { clearerInk, contrastRatio, solveContrast } from './contrast'
import { roleFill } from './colour-roles'
import type { PortalDesign } from './schema'
import {
  STYLE_ELEMENTS,
  type ElementStyle,
  type StyleColour,
  type StyleElement,
  type StyleElementInfo,
  type StylePaint,
  type StyleProp,
  type StyleProps,
  type StyleSheet,
  type StyleState,
} from './style-tokens'
import { partOf, partSelector } from './parts-registry'

type Mode = 'light' | 'dark'
type Vars = Required<ThemeVariables>
type TokenMap = Record<`--qb-${string}`, string>

/** Above the portal's own rules and the design's other looks, below the workspace's CSS. */
const ROOT = '[data-portal-theme]:not(#qb)'

const STATE_SELECTOR: Record<Exclude<StyleState, 'base' | 'current'>, string> = {
  hover: ':is(:hover, [data-qb-force=hover])',
  active: ':is(:active, [data-qb-force=active])',
  focus: ':is(:focus-visible, [data-qb-force=focus])',
  disabled: ':is(:disabled, [aria-disabled=true], [data-disabled], [data-qb-force=disabled])',
}

function stateSelector(el: StyleElementInfo, state: StyleState): string {
  if (state === 'base') return ''
  if (state === 'current')
    return `:is(${el.current ?? '[aria-current=page], [data-state=on]'}, [data-qb-force=current])`
  if (state === 'focus' && el.focus) return `:is(${el.focus}, [data-qb-force=focus])`
  return STATE_SELECTOR[state]
}

/** Elements whose hover and pressed fills are drawn from a set normal fill. */
const SHADES: ReadonlySet<StyleElement> = new Set([
  'button',
  'secondary',
  'ghost',
  'navItem',
  'tab',
  'chip',
  'vote',
])

/** Elements whose fill sits on a card rather than on the page, when they draw none of their own. */
const ON_CARD: ReadonlySet<StyleElement> = new Set([
  'postCard',
  'panel',
  'block',
  'input',
  'badge',
  'chip',
])

/** WCAG's large text, which reads at 3:1: 24px at any weight, or 18.66px (14pt) bold. */
const LARGE_ANY = 24
const LARGE_BOLD = 18.66

/** The smallest a set size is drawn: a large one scales down on a phone (sizeCss). */
const smallestOf = (v: number) => (v >= 28 ? Math.max(16, v * 0.6) : v)

/**
 * Whether every headline the design draws is large text: its smallest size
 * wherever it is set, phones included, at least 24px, or 18.66px bold. Left
 * unset, a headline is never under 24px (the band's floor, the page titles'
 * smallest).
 */
export function largeHeadline(doc: PortalDesign): boolean {
  const sizes: number[] = []
  const weights: number[] = []
  for (const scope of scopesOf(doc))
    for (const [sheet, phone] of [
      [scope.sheet, false],
      [scope.dark, false],
      [scope.phone, true],
    ] as const)
      for (const props of Object.values(sheet?.headline ?? {}) as Array<StyleProps | undefined>) {
        if (typeof props?.size === 'number') sizes.push(phone ? props.size : smallestOf(props.size))
        if (typeof props?.weight === 'number') weights.push(props.weight)
      }
  const smallest = Math.min(LARGE_ANY, ...sizes)
  const weight = Math.min(
    ...(weights.length ? weights : [doc.tune?.headline?.weight ?? doc.brand.fonts.headingWeight])
  )
  return smallest >= LARGE_ANY || (smallest >= LARGE_BOLD && weight >= 700)
}

export const STYLE_SHADOW_CSS = {
  ...SHADOW,
  glow: '0 0 0 4px color-mix(in oklch, var(--qb-accent) 22%, transparent)',
} as const

/** The roles an exact colour can be, to draw it as that role's own in dark mode. */
const SNAP_ROLES = [
  'accent',
  'support',
  'extra1',
  'extra2',
  'ink',
  'muted',
  'page',
  'surface',
  'raised',
  'border',
  'accent-text',
  'on-accent',
] as const
/** Within this oklab distance an exact colour is the role it is near: a step no one would see. */
const SNAP = 0.03

/**
 * An exact colour set for light, as dark mode draws it, in a design that
 * shows both: the role it is in light, in that role's dark colour; else its
 * lightness mirrored, light page to dark page and light text to dark text,
 * in its own hue. Text on it is then solved to read as any text is. A
 * design that shows only dark keeps the colour as set.
 */
function darkExact(hex: string, doc: PortalDesign, t: Vars, light: Vars | undefined): string {
  if (!light) return hex
  let near: StyleColour | null = null
  let gap = SNAP
  for (const role of SNAP_ROLES) {
    const distance = oklabDistance(hex, styleColourValue(role, doc, light, 'light'))
    if (distance < gap) [near, gap] = [role, distance]
  }
  if (near) return styleColourValue(near, doc, t, 'dark')
  const [page, ink] = [lchOf(light.background).l, lchOf(light.foreground).l]
  const [darkPage, darkInk] = [lchOf(t.background).l, lchOf(t.foreground).l]
  const own = lchOf(hex)
  const share = page === ink ? 0 : (own.l - ink) / (page - ink)
  return fitted({ ...own, l: Math.min(1, Math.max(0, darkInk + (darkPage - darkInk) * share)) })
}

/**
 * A named or exact colour, as this mode draws it. Given light's colours, an
 * exact colour, white and black take a dark counterpart in dark mode: white
 * (or #ffffff) is the card, black (or #000000) the text, any other as
 * darkExact draws it.
 */
export function styleColourValue(
  ref: StyleColour,
  doc: PortalDesign,
  t: Vars,
  mode: Mode,
  light?: Vars
): string {
  const dark = mode === 'dark' && !!light
  switch (ref) {
    case 'accent':
      return t.primary
    case 'support':
    case 'extra1':
    case 'extra2':
      return roleFill(doc, t, mode, ref).fill
    case 'ink':
      return t.foreground
    case 'muted':
      return t.mutedForeground
    case 'page':
      return t.background
    case 'surface':
      return t.card
    case 'raised':
      return t.muted
    case 'border':
      return t.border
    case 'accent-text':
      return t.accentInk
    case 'on-accent':
      return t.primaryForeground
    case 'white':
      return dark ? t.card : '#ffffff'
    case 'black':
      return dark ? t.foreground : '#000000'
    case 'transparent':
      return 'transparent'
    default:
      if (!dark) return ref
      if (/^#f{6}$/i.test(ref)) return t.card
      if (/^#0{6}$/i.test(ref)) return t.foreground
      return darkExact(ref, doc, t, light)
  }
}

/**
 * A colour a row stores, as dark mode draws it: dark mode's own colour as it
 * is, else light's carried over to dark; null with no dark variables.
 */
export function darkDrawnColour(
  stored: StyleColour,
  ownDark: StyleColour | undefined,
  doc: PortalDesign,
  light: ThemeVariables | null,
  dark: ThemeVariables | null
): string | null {
  if (!dark) return null
  return ownDark
    ? styleColourValue(ownDark, doc, dark as Vars, 'dark')
    : styleColourValue(stored, doc, dark as Vars, 'dark', light ? (light as Vars) : undefined)
}

/** A fill's colours (one, or a gradient's two) and its CSS. */
function paintOf(
  paint: StylePaint,
  doc: PortalDesign,
  t: Vars,
  mode: Mode,
  light?: Vars
): { css: string; colours: string[] } {
  if (typeof paint === 'string') {
    const c = styleColourValue(paint, doc, t, mode, light)
    return { css: c, colours: c === 'transparent' ? [] : [c] }
  }
  const from = styleColourValue(paint.from, doc, t, mode, light)
  const to = styleColourValue(paint.to, doc, t, mode, light)
  return {
    css: `linear-gradient(${paint.angle ?? 180}deg, ${from}, ${to})`,
    colours: [from, to].filter((c) => c !== 'transparent'),
  }
}

const lightness = (c: string) => contrastRatio(c, '#000000') / 21

/** A fill a little darker, or lighter on a dark fill. */
function shade(colour: string, by: number): string {
  return mixColor(colour, lightness(colour) > 0.25 ? '#000000' : '#ffffff', 1 - by)
}

const px = (v: number) => `${+v.toFixed(3)}px`
/** A large size scales down on a phone, as tuned headlines do. */
const sizeCss = (v: number) =>
  v >= 28
    ? `clamp(${px(Math.max(16, v * 0.6))}, ${+((v / 1440) * 100).toFixed(3)}vw, ${px(v)})`
    : px(v)

/** Each set property's declarations, reading its variable. */
function declarations(
  element: StyleElement,
  prop: StyleProp,
  v: string,
  own: StyleProps
): string[] {
  switch (prop) {
    case 'background':
      return [`background: ${v}`]
    case 'color':
      return element === 'hero'
        ? [
            `color: ${v}`,
            `--qb-band-ink: ${v}`,
            `--qb-band-muted: ${v}`,
            `--qb-band-headline: ${v}`,
            `--qb-band-subtitle: ${v}`,
          ]
        : [`color: ${v}`, '--tw-prose-body: currentColor']
    case 'borderColor':
      return element === 'divider' ? [] : [`border-color: ${v}`]
    case 'borderWidth':
      return element === 'divider'
        ? []
        : [`border-width: ${v}`, ...(own.borderStyle ? [] : ['border-style: solid'])]
    case 'borderStyle':
      return element === 'divider' ? [] : [`border-style: ${v}`]
    case 'radius':
      return [`border-radius: ${v}`]
    case 'shadow':
      return [`box-shadow: ${v}`]
    case 'paddingX':
      return [`padding-inline: ${v}`]
    case 'paddingY':
      return [`padding-block: ${v}`]
    case 'font':
      return [`font-family: ${v}`]
    case 'size':
      return [`font-size: ${v}`]
    case 'weight':
      return [`font-weight: ${v}`]
    case 'case':
      return [`text-transform: ${v}`]
    case 'tracking':
      return [`letter-spacing: ${v}`]
    case 'leading':
      return [`line-height: ${v}`]
    case 'underline':
      return [`text-decoration-line: ${v}`, 'text-underline-offset: 0.15em']
    case 'lift':
      return []
    case 'height':
      return [`min-height: ${v}`]
    case 'opacity':
      return [`opacity: ${v}`]
    case 'ringWidth':
      // The ring keeps the neutral focus colour; only its width is set.
      return [`outline-width: ${v}`, 'outline-style: solid', 'outline-color: var(--ring)']
  }
}

/** A property's value for the variable, in a mode; colours are resolved by the caller. */
function plainValue(prop: StyleProp, value: unknown): string {
  switch (prop) {
    case 'size':
      return sizeCss(value as number)
    case 'borderWidth':
    case 'radius':
    case 'paddingX':
    case 'paddingY':
    case 'lift':
    case 'height':
    case 'ringWidth':
      return px(value as number)
    case 'tracking':
      return `${value}em`
    case 'shadow':
      return STYLE_SHADOW_CSS[value as keyof typeof STYLE_SHADOW_CSS]
    case 'font':
      return `var(--qb-font-${value as string})`
    case 'case':
      return { none: 'none', upper: 'uppercase', lower: 'lowercase', capitalize: 'capitalize' }[
        value as 'none'
      ]
    case 'underline':
      return value === 'underline' ? 'underline' : 'none'
    default:
      return String(value)
  }
}

/** A text colour as drawn, and what it was checked against. */
export interface StyleCheck {
  /** `style.button.hover`, or `block <id> card.hover`. */
  where: string
  mode: Mode
  /** The colour set, or null where the fill was set without text. */
  set: string | null
  /** The colour drawn, moved until it reads; null when none does. */
  used: string | null
  on: string
  target: number
}

export interface StyleOutput {
  tokens: { light: TokenMap; dark: TokenMap }
  css: string
  checks: StyleCheck[]
}

/** The design layer's sub-layers, lowest first: the rest of the design, then each scope of element looks. */
export const DESIGN_LAYERS = [
  'design.base',
  'design.style',
  'design.page',
  'design.block',
  'design.part',
] as const
type Layer = 'style' | 'page' | 'block' | 'part'

/**
 * Where the portal lays itself out for a phone, as its own `max-sm` does
 * (under 40rem). Written without `<`, which the page's style tag escapes.
 */
export const PHONE_MEDIA = '(max-width: 39.99rem)'

interface Scope {
  /** Its variables' prefix. */
  key: string
  layer: Layer
  /** Where an element is in it. */
  at: (element: StyleElement, el: StyleElementInfo) => string
  label: string
  sheet: StyleSheet
  dark?: StyleSheet
  phone?: StyleSheet
  /** The sheets under it, lowest first, whose fills its text reads on. */
  below: readonly StyleSheet[]
}

const one = (element: StyleElement, style: ElementStyle | undefined): StyleSheet =>
  style ? ({ [element]: style } as StyleSheet) : {}

/** Every scope of element looks a design has, in cascade order. */
function scopesOf(doc: PortalDesign): Scope[] {
  const scopes: Scope[] = []
  const site = doc.style ?? {}
  if (doc.style || doc.stylePhone)
    scopes.push({
      key: '',
      layer: 'style',
      at: (_, el) => `${ROOT} ${el.selector}`,
      label: 'style',
      sheet: site,
      dark: doc.styleDark,
      phone: doc.stylePhone,
      below: [],
    })
  const overrides = doc.overrides ?? []
  const pageSheets = new Map<string, StyleSheet[]>()
  overrides.forEach((o, i) => {
    if (o.target.scope !== 'page') return
    const { page, element } = o.target
    const sheet = one(element, o.style)
    pageSheets.set(page, [...(pageSheets.get(page) ?? []), sheet])
    scopes.push({
      key: `g${i}-`,
      layer: 'page',
      at: (_, el) => `${ROOT} [data-qb-page=${page}] ${el.selector}`,
      label: `page ${page}`,
      sheet,
      dark: one(element, o.styleDark),
      phone: one(element, o.phone),
      below: [site],
    })
  })
  const blockSheets = new Map<string, StyleSheet>()
  for (const block of doc.pages.home.blocks) {
    const sheet = block.look?.style as StyleSheet | undefined
    const phone = block.look?.phone as StyleSheet | undefined
    if ((!sheet && !phone) || !block.id) continue
    const prefix = `${ROOT} [data-qb-section="block-${block.id}"]`
    if (sheet) blockSheets.set(block.id, sheet)
    scopes.push({
      key: `b${block.id}-`,
      layer: 'block',
      at: (element, el) => (element === 'block' ? prefix : `${prefix} ${el.selector}`),
      label: `block ${block.id}`,
      sheet: sheet ?? {},
      phone,
      below: [site, ...(pageSheets.get('home') ?? [])],
    })
  }
  overrides.forEach((o, i) => {
    if (o.target.scope !== 'part') return
    const { element } = o.target
    const part = partOf(doc, o.target.part)
    if (!part || !part.elements.includes(element)) return
    const pages = part.pages.length === 1 ? (pageSheets.get(part.pages[0]!) ?? []) : []
    const block = part.block ? blockSheets.get(part.block) : undefined
    scopes.push({
      key: `p${i}-`,
      layer: 'part',
      at: () => `${ROOT} ${partSelector(part, element)}`,
      label: `part ${part.id}`,
      sheet: one(element, o.style),
      dark: one(element, o.styleDark),
      phone: one(element, o.phone),
      below: [site, ...pages, ...(block ? [block] : [])],
    })
  })
  return scopes
}

/** A state's own values in a sheet, if any. */
const propsIn = (sheet: StyleSheet | undefined, element: StyleElement, state: StyleState) =>
  (sheet?.[element]?.[state] ?? undefined) as StyleProps | undefined

/** Every element style of a design, as variables per mode and rules that read them. */
export function styleCss(
  doc: PortalDesign,
  light: ThemeVariables | null,
  dark: ThemeVariables | null
): StyleOutput {
  const scopes = scopesOf(doc)
  const large = largeHeadline(doc)
  const out: StyleOutput = { tokens: { light: {}, dark: {} }, css: '', checks: [] }
  const rules: Record<Layer, string[]> = { style: [], page: [], block: [], part: [] }
  const phoneRules: Record<Layer, string[]> = { style: [], page: [], block: [], part: [] }
  const motion: Record<Layer, string[]> = { style: [], page: [], block: [], part: [] }
  for (const scope of scopes) {
    for (const [element, states] of Object.entries(scope.sheet) as Array<
      [StyleElement, ElementStyle]
    >) {
      const el: StyleElementInfo = STYLE_ELEMENTS[element]
      if (!el || !states) continue
      const at = scope.at(element, el)
      const modes: Array<[Mode, ThemeVariables | null]> = [
        ['light', light],
        ['dark', dark],
      ]
      // The fill set under this scope, in a state: the highest one that sets it.
      const fillBelow = (state: StyleState): StylePaint | undefined => {
        for (let i = scope.below.length - 1; i >= 0; i--) {
          const fill =
            propsIn(scope.below[i], element, state)?.background ??
            propsIn(scope.below[i], element, 'base')?.background
          if (fill) return fill
        }
        return undefined
      }
      // Every state it draws: those set, and the hover and pressed fills drawn from a set normal one.
      const base = states.base ?? {}
      const drawn = new Set(Object.keys(states) as StyleState[])
      if (SHADES.has(element) && base.background && typeof base.background === 'string')
        for (const s of ['hover', 'active'] as const)
          if ((el.states as readonly StyleState[]).includes(s)) drawn.add(s)
      const transitions = new Set<string>()
      for (const state of drawn) {
        const own: StyleProps = { ...(states[state] ?? {}) }
        const darkOwn: StyleProps = scope.dark?.[element]?.[state] ?? {}
        const decls: string[] = []
        const lifts: string[] = []
        const name = (prop: string) => `--qb-st-${scope.key}${element}-${state}-${prop}` as const
        const props = new Set<StyleProp>(Object.keys(own) as StyleProp[])
        // A fill drawn here: set, or drawn from the normal one; its text then reads on it.
        const derivedFill =
          !own.background &&
          state !== 'base' &&
          drawn.has(state) &&
          !states[state]?.background &&
          SHADES.has(element) &&
          (state === 'hover' || state === 'active') &&
          !!base.background
        if (derivedFill) props.add('background')
        const texty = (el.props as readonly StyleProp[]).includes('color')
        const fillHere = own.background ?? (derivedFill ? base.background : undefined)
        const textHere = own.color ?? (state !== 'base' ? base.color : undefined)
        if (texty && (fillHere || own.color)) props.add('color')
        for (const prop of props) {
          for (const [mode, vars] of modes) {
            if (!vars) continue
            const t = vars as Vars
            // Light's colours, for a colour set for light to take its dark counterpart (darkExact).
            const fromLight = mode === 'dark' && light ? (light as Vars) : undefined
            const value = valueIn(mode, prop)
            if (value !== null) out.tokens[mode][name(prop)] = value
            function valueIn(mode: Mode, prop: StyleProp): string | null {
              const darkSet = mode === 'dark' ? darkOwn[prop as 'color'] : undefined
              const set = darkSet ?? own[prop]
              const from = darkSet ? undefined : fromLight
              if (prop === 'background') {
                if (set) return paintOf(set as StylePaint, doc, t, mode, from).css
                if (derivedFill) {
                  const fill = paintOf(base.background!, doc, t, mode, fromLight).colours[0]
                  return fill ? shade(fill, state === 'active' ? 0.14 : 0.08) : null
                }
                return null
              }
              if (prop === 'color') return textColour(mode, t)
              if (prop === 'borderColor')
                return set ? styleColourValue(set as StyleColour, doc, t, mode, from) : null
              return set === undefined ? null : plainValue(prop, set)
            }
            function textColour(mode: Mode, t: Vars): string | null {
              // Text the design leaves out: where the other side of light reads too, the clearer one.
              const ownText = (fills: string[], target: number) => {
                const inks = [t.foreground, t.background, t.primaryForeground]
                const ink =
                  inks.find((c) => fills.every((f) => contrastRatio(c, f) >= target)) ??
                  solveContrast(t.foreground, fills, target)
                return ink && clearerInk(ink, fills, [...inks, '#000000', '#ffffff'], target)
              }
              const darkFill = mode === 'dark' ? darkOwn.background : undefined
              const fillSet = darkFill ?? fillHere ?? fillBelow(state)
              let fills: string[]
              if (fillSet) {
                fills = paintOf(fillSet, doc, t, mode, darkFill ? undefined : fromLight).colours
                if (derivedFill && !own.background && fills[0])
                  fills = [shade(fills[0], state === 'active' ? 0.14 : 0.08)]
              } else fills = []
              if (!fills.length) fills = [backdropOf(element, t)]
              const darkText = mode === 'dark' ? darkOwn.color : undefined
              const setText = darkText ?? textHere
              const target = element === 'headline' && large ? 3 : 4.5
              const wanted = setText
                ? styleColourValue(setText, doc, t, mode, darkText ? undefined : fromLight)
                : null
              const used = wanted ? solveContrast(wanted, fills, target) : ownText(fills, target)
              const on = fills.reduce((worst, f) =>
                contrastRatio(used ?? wanted ?? t.foreground, f) <
                contrastRatio(used ?? wanted ?? t.foreground, worst)
                  ? f
                  : worst
              )
              out.checks.push({
                where: `${scope.label}.${element}.${state}`,
                mode,
                set: wanted,
                used,
                on,
                target,
              })
              return used ?? wanted ?? t.foreground
            }
          }
          const v = `var(${name(prop)})`
          if (prop === 'lift') {
            lifts.push(`translate: 0 calc(${v} * -1)`)
            transitions.add('translate')
          } else decls.push(...declarations(element, prop, v, own))
          if (state !== 'base' && (prop === 'background' || prop === 'shadow' || prop === 'color'))
            transitions.add(
              prop === 'shadow' ? 'box-shadow' : prop === 'color' ? 'color' : 'background-color'
            )
        }
        decls.push(...dividerDecls(element, own, (p) => `var(${name(p)})`))
        const selector = `${at}${stateSelector(el, state)}`
        if (decls.length) rules[scope.layer].push(`${selector} { ${decls.join('; ')}; }`)
        if (lifts.length) motion[scope.layer].push(`${selector} { ${lifts.join('; ')}; }`)
      }
      if (transitions.size)
        motion[scope.layer].push(
          `${at} { transition: ${[...transitions].map((p) => `${p} 150ms ease`).join(', ')}; }`
        )
    }
    phoneRules[scope.layer].push(...phoneCss(scope))
  }
  const layers = (['style', 'page', 'block', 'part'] as const).flatMap((layer) => {
    const body = [
      ...rules[layer],
      ...(phoneRules[layer].length
        ? [`@media ${PHONE_MEDIA} { ${phoneRules[layer].join(' ')} }`]
        : []),
      ...(motion[layer].length
        ? [`@media (prefers-reduced-motion: no-preference) { ${motion[layer].join(' ')} }`]
        : []),
    ]
    return body.length ? [`@layer design.${layer} { ${body.join(' ')} }`] : []
  })
  if (layers.length) out.css = layers.join(' ')
  return out
}

/** A divider's edge, drawn as its top border. */
function dividerDecls(
  element: StyleElement,
  own: StyleProps,
  value: (prop: StyleProp) => string
): string[] {
  if (
    element !== 'divider' ||
    !(own.borderColor || own.borderWidth !== undefined || own.borderStyle)
  )
    return []
  const w = own.borderWidth !== undefined ? value('borderWidth') : '1px'
  const c = own.borderColor ? value('borderColor') : 'var(--qb-border, currentColor)'
  return [
    'background: transparent',
    'height: 0',
    'border: 0',
    `border-top: ${w} ${own.borderStyle ?? 'solid'} ${c}`,
  ]
}

/**
 * A scope's phone values, as rules with the values written in: sizes and
 * shapes only, the same in both modes.
 */
function phoneCss(scope: Scope): string[] {
  const out: string[] = []
  for (const [element, states] of Object.entries(scope.phone ?? {}) as Array<
    [StyleElement, ElementStyle]
  >) {
    const el: StyleElementInfo = STYLE_ELEMENTS[element]
    if (!el || !states) continue
    for (const [state, own] of Object.entries(states) as Array<[StyleState, StyleProps]>) {
      if (!own) continue
      const decls: string[] = []
      for (const [prop, value] of Object.entries(own) as Array<[StyleProp, unknown]>) {
        if (value === undefined) continue
        const v = prop === 'size' ? px(value as number) : plainValue(prop, value)
        decls.push(
          ...(prop === 'lift'
            ? [`translate: 0 calc(${v} * -1)`]
            : declarations(element, prop, v, own))
        )
      }
      decls.push(...dividerDecls(element, own, (p) => plainValue(p, own[p])))
      if (decls.length)
        out.push(`${scope.at(element, el)}${stateSelector(el, state)} { ${decls.join('; ')}; }`)
    }
  }
  return out
}

/** What an element sits on when it draws no fill of its own. */
function backdropOf(element: StyleElement, t: Vars): string {
  return ON_CARD.has(element) ? t.card : t.background
}
