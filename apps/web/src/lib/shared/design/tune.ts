/**
 * Exact values under the design's choices. A brand sits between the tiles'
 * steps: its headline is 48px at weight 300, its buttons 40px tall with 4px
 * corners. A design can say so exactly, and each value it leaves out keeps
 * what the tiles choose. Every value is bounded, so no tune can break a page.
 */
import { z } from 'zod'

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

export const tuneSchema = z
  .object({
    /** Page headlines. */
    headline: type.optional(),
    /** Section headings, such as a Home block's title. */
    heading: type.optional(),
    /** The menu and buttons. */
    label: type.omit({ leading: true }).optional(),
    button: z
      .object({
        /** Corners in px; 999 is a pill. */
        radius: z.number().min(0).max(999).optional(),
        height: z.number().min(24).max(72).optional(),
      })
      .strict()
      .optional(),
    card: z
      .object({
        radius: z.number().min(0).max(48).optional(),
        /** Edge width in px; 0 is none. */
        border: z.number().min(0).max(4).optional(),
        shadow: z.enum(['none', 'soft', 'lifted']).optional(),
      })
      .strict()
      .optional(),
    field: z
      .object({ radius: z.number().min(0).max(999).optional() })
      .strict()
      .optional(),
  })
  .strict()

export type Tune = z.output<typeof tuneSchema>

const px = (value: number) => `${+value.toFixed(2)}px`

/** A wide-screen size that scales down on a phone, never below a readable floor. */
function fluid(size: number, floor: number): string {
  const min = Math.min(size, Math.max(floor, size * 0.55))
  return `clamp(${px(min)}, ${+((size / 1440) * 100).toFixed(3)}vw, ${px(size)})`
}

type TokenMap = Record<`--${string}`, string>

/** The tokens a tune sets over the tiles' own. */
export function tuneTokens(tune: Tune | undefined): TokenMap {
  if (!tune) return {}
  const out: TokenMap = {}
  const { headline, heading, label, button, card, field } = tune
  if (headline?.size) {
    out['--qb-headline-size'] = fluid(headline.size, 28)
    // The other pages' titles sit a step below, as they do on the tiles' scale.
    out['--qb-page-title-size'] = fluid(Math.max(headline.size * 0.62, heading?.size ?? 0, 24), 24)
  }
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

const SHADOW = {
  none: 'none',
  soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)',
  lifted: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
} as const

/** The rules a tune needs beyond its tokens, for the parts the tiles do not size. */
export function tuneCss(tune: Tune | undefined): string {
  if (!tune) return ''
  const rules: string[] = []
  const { heading, label, button, card } = tune
  if (heading?.size || heading?.tracking !== undefined || heading?.leading)
    rules.push(
      `[data-portal-theme] [data-qb-part=section-heading] { ${[
        heading.size && 'font-size: var(--qb-heading-size)',
        heading.tracking !== undefined && 'letter-spacing: var(--qb-heading-tracking)',
        heading.leading && 'line-height: var(--qb-heading-leading)',
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (label?.size || label?.weight)
    rules.push(
      `[data-portal-theme] :is([data-qb-part=nav-item], [data-slot=button]) { ${[
        label.size && 'font-size: var(--qb-label-size)',
        label.weight && 'font-weight: var(--qb-label-weight)',
      ]
        .filter(Boolean)
        .join('; ')}; }`
    )
  if (button?.height)
    rules.push(
      '[data-portal-theme] [data-slot=button][data-variant=default] { min-height: var(--qb-button-height); padding-inline: calc(var(--qb-button-height) * 0.45); }'
    )
  if (card) {
    const parts = [
      card.radius !== undefined && 'border-radius: var(--qb-radius-card)',
      card.border !== undefined && `border-width: ${px(card.border)}`,
      card.shadow && `box-shadow: ${SHADOW[card.shadow]}`,
    ].filter(Boolean)
    if (parts.length)
      // After the card styles, at their weight, so a tune wins.
      rules.push(
        `[data-qb-cards][data-portal-theme] [data-qb-surface=card] { ${parts.join('; ')}; }`
      )
  }
  return rules.length ? `@layer design { ${rules.join(' ')} }` : ''
}
