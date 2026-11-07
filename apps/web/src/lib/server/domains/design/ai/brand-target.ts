/**
 * What a brand match measured, as a fingerprint by the rig's roles, for the
 * verified critic loop to score the drawn preview against. Only what the
 * tools measured is in it: the headline's size, weight, tracking, line
 * height, case and colour; the main button's fill, corners and height; the
 * card's corners, edge and shadow; the page colour where it is quiet
 * enough to be a page (a lime band read as the page is not). A property nobody
 * measured is left out, and the score leaves it out too.
 *
 * The target is meant to be the site's own rendered truth by the rig's
 * roles, so the check scores against the site, not against the match's own
 * choices: where the measuring reads the site right, a revision towards the
 * site's real value raises the measured score and is kept. Its accuracy is
 * what makes the check worth running: on a payments site's capture the 11-02 read
 * (headline 500, the hero's 48px button) agreed with the site's fingerprint
 * at 82; the current one (300, the header's 41px) at 99 (brand-check.test.ts).
 */
import { hexToRgb, type Fingerprint } from '@/lib/shared/design/fingerprint'
import { colourVividness } from '@/lib/shared/design/palette'
import type { RGB } from '../extract/color'
import type { MeasuredDesign } from '../extract/measured-design'
import type { ColourRoles } from '../extract/roles'

const rgb = ([r, g, b]: RGB) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`

/** A page colour quiet enough to be a page, as the match uses it (colourChanges); else unknown. */
function pageColour(hex: string): string | null {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return light > 0.8 && colourVividness(hex) <= 0.2 ? hexToRgb(hex) : null
}

const defined = <T extends object>(o: T): T | null => {
  const kept = Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
  )
  return Object.keys(kept).length ? (kept as T) : null
}

export function targetFingerprint({
  measured,
  roles,
  headlineInk,
}: {
  measured: MeasuredDesign | null
  roles: ColourRoles | null
  /** The headline's text colour as measured, when it was. */
  headlineInk?: RGB | null
}): Fingerprint {
  const tune = measured?.tune ?? {}
  const fields = measured?.fields ?? {}
  const h = tune.headline
  const headline = defined({
    size: h?.size,
    weight: h?.weight,
    tracking: h?.tracking,
    leading: h?.leading,
    transform: fields.textCase ? (fields.textCase === 'upper' ? 'uppercase' : 'none') : undefined,
    color: headlineInk ? rgb(headlineInk) : undefined,
  })
  const button = defined({
    bg: roles ? (hexToRgb(roles.action.value.hex) ?? undefined) : undefined,
    radius: tune.button?.radius,
    height: tune.button?.height,
  })
  const card = tune.card
    ? defined({
        radius: tune.card.radius,
        borderWidth: tune.card.border,
        shadow: tune.card.shadow ? tune.card.shadow !== 'none' : undefined,
      })
    : null
  return {
    page: roles ? pageColour(roles.page) : null,
    headline,
    button,
    card,
  }
}
