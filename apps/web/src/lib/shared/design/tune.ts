/**
 * Exact values under the design's choices. A brand sits between the tiles'
 * steps: its headline is 48px at weight 300, its buttons 40px tall with 4px
 * corners. A design can say so exactly, and each value it leaves out keeps
 * what the tiles choose. Every value is bounded, so no tune can break a page.
 */
import { z } from 'zod'
import { oklchToHex } from '@/lib/shared/theme/colors'
import { ownColour } from './colour-roles'
import { contrastRatio, solveContrast } from './contrast'
import { WORD_GAP_FLOOR } from './fonts'
import type { PortalDesign } from './schema'

const hex = z.string().regex(/^#[0-9a-f]{6}$/i)

/**
 * The brand colours an exact colour may name instead of a hex, so it follows
 * the brand: the brand colour, the second and extra colours, the text and the
 * page, each as light mode has it (tune colours are light mode's own).
 */
export const TUNE_COLOUR_ROLES = ['accent', 'support', 'extra1', 'extra2', 'ink', 'page'] as const
export type TuneColourRole = (typeof TUNE_COLOUR_ROLES)[number]
/** An exact colour: a hex, or a brand colour by its role. */
const colour = z.union([hex, z.enum(TUNE_COLOUR_ROLES)])

/** A card's shadow, shallowest first. */
export const CARD_SHADOWS = ['none', 'soft', 'lifted', 'floating', 'deep'] as const
export type CardShadow = (typeof CARD_SHADOWS)[number]

const type = z
  .object({
    /** Its size on a wide screen, in px; it scales down on a phone. */
    size: z.number().min(10).max(200).optional(),
    weight: z.number().int().min(100).max(900).optional(),
    /** Letter-spacing, in em. */
    tracking: z.number().min(-0.1).max(0.3).optional(),
    /** Line height, as a multiple of the size. */
    leading: z.number().min(0.8).max(2.2).optional(),
  })
  .strict()

/** A headline's or heading's own colour, in light mode, where it reads. */
const coloured = type.extend({ colour: colour.optional() })

export const tuneSchema = z
  .object({
    /** Page headlines. */
    headline: coloured.optional(),
    /** The line under a page headline, in px, its weight, and its own colour where it reads. */
    subtitle: z
      .object({
        size: z.number().min(12).max(32).optional(),
        weight: z.number().int().min(100).max(900).optional(),
        colour: colour.optional(),
      })
      .strict()
      .optional(),
    /** Section headings, such as a Home block's title. */
    heading: coloured.optional(),
    /** The menu and buttons. */
    label: type.omit({ leading: true }).optional(),
    button: z
      .object({
        /** Corners in px; 999 is a pill. */
        radius: z.number().min(0).max(999).optional(),
        height: z.number().min(24).max(72).optional(),
        /** A primary button's own fill and label, in light mode. */
        fill: colour.optional(),
        ink: colour.optional(),
        weight: z.number().int().min(100).max(900).optional(),
        case: z.enum(['sentence', 'upper']).optional(),
      })
      .strict()
      .optional(),
    card: z
      .object({
        radius: z.number().min(0).max(48).optional(),
        /** Edge width in px; 0 is none. */
        border: z.number().min(0).max(4).optional(),
        /** How far it floats: none, a hairline, lifted, floating on a soft shadow, or deep. */
        shadow: z.enum(CARD_SHADOWS).optional(),
        /** A post card's title, in px, and its weight. */
        titleSize: z.number().min(12).max(28).optional(),
        titleWeight: z.number().int().min(100).max(900).optional(),
      })
      .strict()
      .optional(),
    field: z
      .object({ radius: z.number().min(0).max(999).optional() })
      .strict()
      .optional(),
    /** Links in text, such as a block's way on. */
    link: z
      .object({
        /** Its own colour, in light mode, where it reads. */
        colour: colour.optional(),
        underline: z.enum(['always', 'hover', 'never']).optional(),
        weight: z.number().int().min(100).max(900).optional(),
      })
      .strict()
      .optional(),
    /** Buttons beside the main one, such as Log in. */
    secondary: z
      .object({ style: z.enum(['outline', 'tint', 'text']).optional() })
      .strict()
      .optional(),
    /** Body text: rich text and the text on cards, in px, and its line height. */
    body: z
      .object({
        size: z.number().min(12).max(20).optional(),
        leading: z.number().min(1.2).max(2).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type Tune = z.output<typeof tuneSchema>

/** Where a tune holds a colour: each group's colour fields. */
const TUNE_COLOUR_FIELDS = {
  headline: ['colour'],
  subtitle: ['colour'],
  heading: ['colour'],
  button: ['fill', 'ink'],
  link: ['colour'],
} as const

const asHex = (value: string) => (value.startsWith('#') ? value : oklchToHex(value))

/** A brand role's colour in light mode, as a hex; a colour the brand has not got is the brand colour. */
export function tuneRoleHex(doc: PortalDesign, role: TuneColourRole): string {
  const light = doc.brand.light
  if (role === 'ink') return asHex(light.ink)
  if (role === 'page') return asHex(light.background)
  return asHex((role !== 'accent' && ownColour(doc, 'light', role)) || light.accent)
}

/**
 * A design's tune with each colour named by role drawn as its hex, as the
 * renderer and every reader of a tune's colours take it. A tune that names no
 * role is returned as it is, so it draws exactly as it did.
 */
export function tuneHexes(doc: PortalDesign): Tune | undefined {
  const tune = doc.tune
  if (!tune) return tune
  const isRole = (v: unknown): v is TuneColourRole =>
    (TUNE_COLOUR_ROLES as readonly unknown[]).includes(v)
  const groups = Object.entries(TUNE_COLOUR_FIELDS) as Array<[keyof Tune, readonly string[]]>
  if (
    !groups.some(([g, keys]) =>
      keys.some((k) => isRole((tune[g] as Record<string, unknown> | undefined)?.[k]))
    )
  )
    return tune
  const out = { ...tune } as Record<string, Record<string, unknown> | undefined>
  for (const [group, keys] of groups) {
    const fields = out[group]
    if (!fields) continue
    const next = { ...fields }
    for (const key of keys) {
      const value = next[key]
      if (isRole(value)) next[key] = tuneRoleHex(doc, value)
    }
    out[group] = next
  }
  return out as Tune
}

const px = (value: number) => `${+value.toFixed(2)}px`

/** A wide-screen size that scales down on a phone, never below a readable floor. */
/**
 * The largest type a long word (about ten letters) fits a phone at: 14vw, or
 * 45px on the narrowest (320px). Smaller sizes are left as they are.
 */
const PHONE_SAFE_VW = 14
const PHONE_SAFE = 44

function fluid(size: number, floor: number): string {
  const min = Math.min(size, Math.max(floor, size * 0.55))
  // A poster size's smallest is still wider than a word fits on a phone, so it gives way to the screen.
  const least = min > PHONE_SAFE ? `min(${px(min)}, ${PHONE_SAFE_VW}vw)` : px(min)
  return `clamp(${least}, ${+((size / 1440) * 100).toFixed(3)}vw, ${px(size)})`
}

type TokenMap = Record<`--${string}`, string>

/** The tokens a tune sets over the tiles' own. */
export function tuneTokens(tune: Tune | undefined): TokenMap {
  if (!tune) return {}
  const out: TokenMap = {}
  const { headline, heading, label, button, card, field, subtitle } = tune
  if (card?.titleSize) out['--qb-title-size'] = px(card.titleSize)
  if (headline?.size) {
    out['--qb-headline-size'] = fluid(headline.size, 28)
    // The other pages' titles sit a step below, as they do on the tiles' scale.
    out['--qb-page-title-size'] = fluid(Math.max(headline.size * 0.62, heading?.size ?? 0, 24), 24)
    // Its line grows with it: 17px under a 48px headline, 22px under a 100px one.
    out['--qb-subtitle-size'] = fluid(Math.min(22, Math.max(16, 12 + headline.size * 0.1)), 16)
  }
  if (subtitle?.size) out['--qb-subtitle-size'] = fluid(subtitle.size, 16)
  if (headline?.weight) out['--qb-headline-weight'] = String(headline.weight)
  if (headline?.tracking !== undefined) out['--qb-headline-tracking'] = `${headline.tracking}em`
  if (headline?.leading) out['--qb-headline-leading'] = String(headline.leading)
  if (heading?.size) out['--qb-heading-size'] = fluid(heading.size, 16)
  if (heading?.weight) out['--qb-heading-weight'] = String(heading.weight)
  if (heading?.tracking !== undefined) out['--qb-heading-tracking'] = `${heading.tracking}em`
  if (heading?.leading) out['--qb-heading-leading'] = String(heading.leading)
  if (label?.size) out['--qb-label-size'] = px(label.size)
  if (label?.weight) out['--qb-label-weight'] = String(label.weight)
  if (label?.tracking !== undefined) out['--qb-label-tracking'] = `${label.tracking}em`
  if (button?.radius !== undefined) out['--qb-radius-button'] = px(button.radius)
  if (button?.height) out['--qb-button-height'] = px(button.height)
  if (card?.radius !== undefined) out['--qb-radius-card'] = px(card.radius)
  if (field?.radius !== undefined) {
    out['--qb-radius-field'] = px(field.radius)
    out['--qb-radius-composer'] = px(field.radius)
  }
  return out
}

/** Every primary button: the component library's, and the band's own call to action. */
export const PRIMARY_BUTTONS = '[data-slot=button][data-variant=default], [data-qb-action]'

export const SHADOW = {
  none: 'none',
  soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)',
  lifted: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  // As the brands whose cards float draw them (X0 truth: their shadows reach 9 to 63px
  // below, in two groups near 17 and 50): floating reaches about 18px, deep about 50.
  floating: '0 6px 18px -4px rgb(0 0 0 / 0.14), 0 1px 3px rgb(0 0 0 / 0.05)',
  deep: '0 18px 48px -12px rgb(0 0 0 / 0.2), 0 4px 10px -4px rgb(0 0 0 / 0.06)',
} as const satisfies Record<(typeof CARD_SHADOWS)[number], string>

/** The rules a tune needs beyond its tokens, for the parts the tiles do not size. */
export function tuneCss(tune: Tune | undefined): string {
  if (!tune) return ''
  const rules: string[] = []
  const { heading, label, button, card } = tune
  if (heading?.size || heading?.tracking !== undefined || heading?.leading)
    rules.push(
      `[data-portal-theme] [data-qb-part=section-heading] { ${[
        heading.size && 'font-size: var(--qb-heading-size)',
        heading.tracking !== undefined &&
          `letter-spacing: var(--qb-heading-tracking); word-spacing: max(0em, calc(${WORD_GAP_FLOOR} - var(--qb-heading-tracking) - var(--qb-heading-space)))`,
        heading.leading && 'line-height: var(--qb-heading-leading)',
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (label?.size || label?.weight)
    rules.push(
      `[data-portal-theme] :is([data-qb-part=nav-item], [data-slot=button], [data-qb-action]) { ${[
        label.size && 'font-size: var(--qb-label-size)',
        label.weight && 'font-weight: var(--qb-label-weight)',
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (button?.height)
    rules.push(
      `[data-portal-theme] :is(${PRIMARY_BUTTONS}) { min-height: var(--qb-button-height); padding-inline: calc(var(--qb-button-height) * 0.45); }`,
      // In the header, a brand's tall button keeps to a header's size, inset from its edges.
      `[data-portal-theme] .portal-header :is(${PRIMARY_BUTTONS}) { min-height: min(var(--qb-button-height), 2.5rem); padding-inline: calc(min(var(--qb-button-height), 2.5rem) * 0.45); }`
    )
  // A button's type is the same in both modes; only its colours are light mode's.
  if (button?.weight || button?.case)
    rules.push(
      `[data-portal-theme] :is(${PRIMARY_BUTTONS}) { ${[
        button.weight && `font-weight: ${button.weight}`,
        button.case && `text-transform: ${button.case === 'upper' ? 'uppercase' : 'none'}`,
        button.case === 'upper' && 'letter-spacing: 0.04em',
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (card) {
    const parts = [
      card.radius !== undefined && 'border-radius: var(--qb-radius-card)',
      card.border !== undefined && `border-width: ${px(card.border)}`,
    ].filter(Boolean)
    // A card's shadow gives way to a focus ring, which is drawn as one.
    if (card.shadow)
      rules.push(
        `[data-qb-cards][data-portal-theme] [data-qb-surface=card]:not(:focus-visible) { box-shadow: ${SHADOW[card.shadow]}; }`
      )
    if (parts.length)
      // After the card styles, at their weight, so a tune wins.
      rules.push(
        `[data-qb-cards][data-portal-theme] [data-qb-surface=card] { ${parts.join('; ')}; }`
      )
  }
  rules.push(...partRules(tune))
  return rules.length ? `@layer design { ${rules.join(' ')} }` : ''
}

/** Links, secondary buttons, body text, card titles and the subtitle, where a tune sets them. */
const LINKS = '[data-portal-theme] :is(.prose a, [data-qb-link])'
const SECONDARY =
  '[data-portal-theme] [data-slot=button]:is([data-variant=outline], [data-variant=secondary])'
const SECONDARY_STYLE = {
  outline:
    'background: transparent; border: 1px solid var(--qb-accent); color: var(--qb-accent-text)',
  tint: 'background: color-mix(in oklch, var(--qb-accent) 12%, var(--qb-surface)); border-color: transparent; color: var(--qb-accent-text)',
  text: 'background: transparent; border-color: transparent; color: var(--qb-accent-text)',
} as const
function partRules(tune: Tune): string[] {
  const rules: string[] = []
  const { link, secondary, body, card, subtitle } = tune
  if (subtitle?.weight)
    rules.push(`[data-portal-theme] [data-qb-part=subtitle] { font-weight: ${subtitle.weight}; }`)
  if (link?.underline || link?.weight)
    rules.push(
      `${LINKS} { ${[
        link.weight && `font-weight: ${link.weight}`,
        link.underline &&
          `text-decoration-line: ${link.underline === 'always' ? 'underline' : 'none'}`,
        link.underline && 'text-underline-offset: 0.15em',
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (link?.underline === 'hover') rules.push(`${LINKS}:hover { text-decoration-line: underline; }`)
  if (secondary?.style) rules.push(`${SECONDARY} { ${SECONDARY_STYLE[secondary.style]}; }`)
  if (body?.size || body?.leading)
    rules.push(
      `[data-portal-theme] :is(.prose, [data-qb-part=post-excerpt]) { ${[
        body.size && `font-size: ${px(body.size)}`,
        body.leading && `line-height: ${body.leading}`,
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (card?.titleWeight)
    rules.push(
      `[data-portal-theme] [data-qb-part=post-title] { font-weight: ${card.titleWeight}; }`
    )
  return rules
}

/** The page a tune's colours sit on, in light mode, to check they read there. */
export interface TuneSurface {
  background: string
  /** The band's colours behind a headline; none with no band. */
  band: string[]
  /** The headline sits on an image: no one colour reads on all of it. */
  mixed: boolean
  /** The colours a page background puts behind the page's text, beyond the page colour. */
  page?: string[]
  /** The band's own subtitle, where it turns light on a bright band, and the contrast it reads at (components.ts bandWords). */
  subtitle?: { ink: string; target: number }
  /** The contrast a headline reads at: 3:1 while it is large text everywhere (style-css.ts largeHeadline). */
  headline?: number
}

/** An exact text colour as drawn: the one set, and the one used so it reads, or null when none does. */
export interface TunedColour {
  part: 'Headline' | 'Subtitle' | 'Section headings' | 'Links'
  set: string
  used: string | null
  /** The surface it reads least well on. */
  on: string
  target: number
}

/**
 * The exact text colours a tune sets, in light mode, each moved in lightness
 * until it reads where it sits, so its hue stays: a headline at 3:1 on the
 * page and the band while it is large text, else 4.5:1, its subtitle and a section heading at 4.5:1. A
 * headline or subtitle over a blend or an image is not set, as no one colour reads there.
 */
export function tunedColours(tune: Tune | undefined, surface: TuneSurface | null): TunedColour[] {
  if (!tune || !surface) return []
  const out: TunedColour[] = []
  const page = surface.page ?? []
  const add = (part: TunedColour['part'], set: string, on: string[], target: number) => {
    const used = solveContrast(set, on, target)
    const drawn = used ?? set
    const worst = on.reduce((a, b) => (contrastRatio(drawn, b) < contrastRatio(drawn, a) ? b : a))
    out.push({ part, set, used, on: worst, target })
  }
  const headline = tune.headline?.colour
  if (headline && !surface.mixed)
    add('Headline', headline, [surface.background, ...page, ...surface.band], surface.headline ?? 3)
  const subtitle = tune.subtitle?.colour
  const own = surface.subtitle
  if (subtitle && own) {
    // A light subtitle on a bright band is the band's own light text, set large where it must be.
    const worst = surface.band.reduce((a, b) =>
      contrastRatio(own.ink, b) < contrastRatio(own.ink, a) ? b : a
    )
    out.push({ part: 'Subtitle', set: subtitle, used: own.ink, on: worst, target: own.target })
  }
  // The subtitle is body-sized, so it reads as body text does.
  else if (subtitle && !surface.mixed)
    add('Subtitle', subtitle, [surface.background, ...page, ...surface.band], 4.5)
  const heading = tune.heading?.colour
  // A section heading shrinks to body size on a phone, so it reads as body text does.
  if (heading) add('Section headings', heading, [surface.background, ...page, '#ffffff'], 4.5)
  const link = tune.link?.colour
  if (link) add('Links', link, [surface.background, ...page, '#ffffff'], 4.5)
  return out
}

const TUNED_PART = {
  Headline: '[data-qb-part=headline]',
  Subtitle: '[data-qb-part=subtitle]',
  'Section headings': '[data-qb-part=section-heading]',
  // Inside a block in the brand colour, links keep that block's own colour.
  Links: ':is(.prose a, [data-qb-link]):not([data-qb-tone=brand] *)',
} as const

/**
 * The rules a tune's colours need, in light mode: each exact text colour as
 * it reads (see tunedColours), and a button's label at 4.5:1 on its fill,
 * else the fill's best label.
 */
export function tuneColourCss(tune: Tune | undefined, surface: TuneSurface | null): string {
  if (!tune || !surface) return ''
  const light = '[data-portal-theme]:not(.dark)'
  const rules: string[] = []
  for (const { part, used } of tunedColours(tune, surface))
    if (used) rules.push(`${light} ${TUNED_PART[part]} { color: ${used}; }`)
  const fill = tune.button?.fill
  if (fill) {
    const ink = tune.button?.ink
    const label =
      ink && contrastRatio(ink, fill) >= 4.5
        ? ink
        : contrastRatio('#ffffff', fill) >= contrastRatio('#111111', fill)
          ? '#ffffff'
          : '#111111'
    rules.push(
      `${light} :is(${PRIMARY_BUTTONS}) { background-color: ${fill}; color: ${label}; }`,
      // The band's button in the second colour or the brand colour, when the design asks, stays so.
      `${light}:is([data-qb-band-action=support], [data-qb-band-action=accent]) [data-qb-action] { background-color: var(--qb-action-bg); color: var(--qb-action-ink); }`
    )
  }
  return rules.length ? `@layer design { ${rules.join(' ')} }` : ''
}
