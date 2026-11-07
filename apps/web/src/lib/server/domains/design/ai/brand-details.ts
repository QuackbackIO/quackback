/**
 * The finer type and shape details of a brand match: measured from the
 * screenshot the type and shape are read from (the subtitle's and the
 * section heading's ink, the call to action's label, a text field's
 * corners), mapped to exact values by extract/measured-details.ts, and set
 * as changes. A value not measured this time is cleared, so an earlier
 * match's stays only where this one agrees; colours are light mode's, so a
 * dark site sets none.
 */
import type { RGB } from '../extract/color'
import { cornerRadius } from '../extract/geometry'
import type { Box } from '../extract/kinds'
import type { Measured } from '../extract/measured-design'
import { detailsFromMeasures, type MeasuredDetails } from '../extract/measured-details'
import { measureText, type TextMetrics } from '../extract/text-metrics'
import type { BrandChange } from './brand-decide'
import { headerCta, mainButton, sharpest, type Shot } from './brand-measure'

/**
 * A button's label is read inside its fill: the box drawn in from its edges
 * (a fifth of its height above and below, a third of it at the sides, past
 * a rounded corner) so the frame the ink is told from is the fill, not the
 * page around the button.
 */
export function labelBox(box: Box): Box | null {
  const h = box[3] - box[1]
  const dy = Math.max(2, Math.round(h * 0.2))
  const dx = Math.max(4, Math.round(h * 0.35))
  const inner: Box = [box[0] + dx, box[1] + dy, box[2] - dx, box[3] - dy]
  return inner[2] - inner[0] >= 4 && inner[3] - inner[1] >= 4 ? inner : null
}

/** A label inside a button box, read where the box is sharpest. */
function readLabel(shot: Shot, box: Box | null, text?: string): TextMetrics | null {
  if (!box) return null
  const at = sharpest(shot, box)
  const inner = at.box && labelBox(at.box)
  return inner ? measureText(at.img, inner, { scale: at.scale, ...(text ? { text } : {}) }) : null
}

/**
 * T2 details of one screenshot. The label is the header's call to action's
 * (the button the site's own buttons and the portal's are sized as), else the
 * main button's; its case is read on the main button, with the words the
 * finder read there.
 */
export function measureDetails(
  shot: Shot,
  geometry: Pick<Measured, 'headline' | 'sectionHeading'>,
  headlineInk: RGB | null | undefined
): MeasuredDetails {
  const b = shot.found.snapped
  const words = shot.found.output
  const main = mainButton(shot)
  const cta = headerCta(shot, main)
  const buttonText = readLabel(shot, b.primary_button, words.primary_button_text || undefined)
  const label = cta ? measureText(cta.img, labelBox(cta.box), { scale: cta.scale }) : buttonText
  return detailsFromMeasures({
    headline: geometry.headline,
    headlineInk,
    sectionHeading: geometry.sectionHeading,
    subtitle: measureText(shot.img, b.subtitle, {
      scale: 1,
      ...(words.subtitle_text ? { text: words.subtitle_text } : {}),
    }),
    label,
    buttonText,
    field: b.input_field ? cornerRadius(shot.img, b.input_field, { scale: 1 }) : null,
  })
}

const change = (path: string, value: unknown, why: string): BrandChange => ({ path, value, why })

/** The details as changes: each measured value set, each not measured cleared. */
export function detailChanges(details: MeasuredDetails, scheme: 'light' | 'dark'): BrandChange[] {
  const { tune, why } = details
  const light = scheme === 'light'
  const sub = light ? tune.subtitle?.colour : undefined
  const headingColour = light ? tune.heading?.colour : undefined
  return [
    change(
      'tune.subtitle.colour',
      sub ?? null,
      sub ? why.subtitleColour! : 'the subtitle in the theme’s own text colour'
    ),
    change(
      'tune.heading.leading',
      tune.heading?.leading ?? null,
      why.headingLeading ?? 'the section headings’ own line height: no line pitch read'
    ),
    change(
      'tune.heading.colour',
      headingColour ?? null,
      headingColour ? why.headingColour! : 'the section headings in the text colour'
    ),
    change(
      'tune.label.size',
      tune.label?.size ?? null,
      why.labelSize ?? 'the labels’ own size: no button label read'
    ),
    change(
      'tune.button.case',
      tune.button?.case ?? null,
      why.buttonCase ?? 'the main button’s label as written'
    ),
    change(
      'tune.field.radius',
      tune.field?.radius ?? null,
      why.fieldRadius ?? 'the text fields’ corners follow the design’s'
    ),
  ]
}
