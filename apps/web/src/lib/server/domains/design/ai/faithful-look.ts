/**
 * The faithful look: the first of Quackback AI's looks keeps the brand as its
 * own site shows it. What was read and measured on the site is applied after
 * the model's choices, the way a compiler's check follows a draft: its main
 * button's colour, its hero's colour, its faces, and its type and shapes as
 * exact values. The briefs tell every look what was found.
 */
import { applyDesignChanges, type UntrustedChanges } from '@/lib/shared/design/apply-changes'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  tuneFromMeasurements,
  type BrandMeasurements,
  type MeasuredType,
} from '@/lib/shared/design/measured-tune'
import { nearestBundledFont } from '@/lib/shared/design/font-match'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import type { SiteSignals } from './site-signals'
import type { Tune } from '@/lib/shared/design/tune'

const oklchOf = (colour: string) =>
  /^#[0-9a-f]{6}$/i.test(colour) ? parseOklch(hexToOklch(colour)) : null

const lab = (colour: string) => {
  const c = oklchOf(colour)
  return c
    ? [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)]
    : null
}

/** A colour no evidence is needed for: a label's black or white. */
const neutralLabel = (colour: string) => {
  const c = oklchOf(colour)
  return !!c && c.c < 0.03 && (c.l < 0.25 || c.l > 0.92)
}

/**
 * Whether a colour measured on the site is borne out by what was seen: the
 * screenshot's colours where there is one, else the site's leading colours.
 * A measurement can land on the wrong element, such as an old button a
 * site's bundle still styles, and then it must not override what the model
 * saw.
 */
export function confirmedBy(seen: readonly string[]): (colour: string) => boolean {
  const points = seen.map(lab).filter((p): p is number[] => !!p)
  return (colour) => {
    const p = lab(colour)
    if (!p) return false
    return points.some((q) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) < 0.09)
  }
}

/** The tune with only the colours that were borne out. */
function confirmedTune(tune: Tune, confirm: (colour: string) => boolean): Tune {
  const out = structuredClone(tune)
  if (out.headline?.colour && !confirm(out.headline.colour)) delete out.headline.colour
  if (out.heading?.colour && !confirm(out.heading.colour)) delete out.heading.colour
  if (out.button?.fill && !confirm(out.button.fill)) {
    delete out.button.fill
    delete out.button.ink
  }
  if (out.button?.ink && !neutralLabel(out.button.ink) && !confirm(out.button.ink))
    delete out.button.ink
  return out
}

/**
 * The faithful look with the brand's own type and shapes, exactly as its page
 * sets them, where they could be read: its faces as the bundled faces closest
 * to them, and its sizes, weights, corners and colours as exact values. The
 * other looks are directions of their own and keep their tiles' steps.
 */
export function withMeasuredTune(
  design: PortalDesign,
  site: SiteSignals | null | undefined,
  allows: Omit<UntrustedChanges, 'links'>,
  confirm: (colour: string) => boolean = () => true
): PortalDesign {
  const tune = site?.measured ? confirmedTune(tuneFromMeasurements(site.measured), confirm) : {}
  const heading = nearestBundledFont(site?.fonts.heading)
  const body = nearestBundledFont(site?.fonts.body)
  const changes = [
    ...(heading ? [{ path: 'brand.fonts.heading', value: heading }] : []),
    ...(body ? [{ path: 'brand.fonts.body', value: body }] : []),
    ...(Object.keys(tune).length ? [{ path: 'tune', value: tune }] : []),
  ]
  if (!changes.length) return design
  return applyDesignChanges(design, changes, 'site', {
    ...allows,
    links: new Set(),
    files: new Set(),
  }).design
}

/**
 * The faithful look's buttons as the site's own main button: a coloured one
 * is the brand colour, and a black or near-black one fills buttons with the
 * text colour. A pale or grey fill says nothing about the brand.
 */
export function measuredButton(
  site: SiteSignals | null | undefined,
  confirm: (colour: string) => boolean = () => true
): {
  accent?: string
  fill?: 'ink'
} {
  const fill = site?.measured?.button?.fill
  const colour = fill ? oklchOf(fill) : null
  if (!fill || !colour) return {}
  if (colour.c >= 0.04) return confirm(fill) ? { accent: fill } : {}
  return colour.l < 0.3 ? { fill: 'ink' } : {}
}

/**
 * The faithful look's band as the site's hero: filled with the brand colour
 * when the hero is that colour, else with the hero's colour as the second.
 */
export function measuredBand(
  site: SiteSignals | null | undefined,
  accent: string,
  confirm: (colour: string) => boolean = () => true
): { band?: 'brand' | 'support'; support?: string } {
  const hero = site?.hero
  const fill = hero ? oklchOf(hero) : null
  const own = oklchOf(accent)
  if (!hero || !fill || fill.c < 0.04 || !confirm(hero)) return {}
  const turn = own ? Math.abs(fill.h - own.h) % 360 : 180
  const same = own && Math.min(turn, 360 - turn) <= 20 && Math.abs(fill.l - own.l) < 0.08
  return same ? { band: 'brand' } : { band: 'support', support: hero }
}

/** The bundled faces closest to the site's own, for the looks to start from. */
export function fontBrief(fonts: SiteSignals['fonts']): string | null {
  const heading = nearestBundledFont(fonts.heading)
  const body = nearestBundledFont(fonts.body)
  if (!heading && !body) return null
  return `The closest bundled faces: ${[heading && `headings ${heading}`, body && `text ${body}`].filter(Boolean).join(', ')}.`
}

const typeText = (t: MeasuredType | null | undefined) =>
  t?.size ? `${Math.round(t.size)}px${t.weight ? ` at weight ${t.weight}` : ''}` : null

/** What was measured on the page, so the looks' steps start near it. */
export function measuredBrief(m: BrandMeasurements | null): string | null {
  if (!m) return null
  const button = m.button?.radius ?? null
  const card = m.card?.radius ?? null
  const parts = [
    typeText(m.headline) && `headlines ${typeText(m.headline)}`,
    typeText(m.heading) && `section headings ${typeText(m.heading)}`,
    button !== null && `buttons with ${button >= 999 ? 'pill' : `${Math.round(button)}px`} corners`,
    card !== null && `cards with ${Math.round(card)}px corners`,
  ].filter(Boolean)
  return parts.length ? `Measured on its page: ${parts.join(', ')}.` : null
}
