/**
 * A brand's measured type and shapes, as exact values. What a reader measured
 * on the brand's own pages, such as its headline's rendered size and weight or
 * its buttons' height and corners, rounded to steps a person would choose and
 * held within what any page can carry.
 */
import type { Tune } from './tune'

export interface MeasuredType {
  size?: number
  weight?: number
  /** In em. */
  tracking?: number
  /** As a multiple of the size. */
  leading?: number
  /** Six-digit hex. */
  colour?: string
}

export interface MeasuredBox {
  /** In px; 999 or more is a pill. */
  radius?: number | null
  height?: number
  borderWidth?: number
  shadow?: boolean
  /** A button's fill and label, six-digit hex. */
  fill?: string
  ink?: string
  weight?: number
  upper?: boolean
}

export interface BrandMeasurements {
  headline?: MeasuredType | null
  heading?: MeasuredType | null
  label?: MeasuredType | null
  button?: MeasuredBox | null
  card?: MeasuredBox | null
  field?: MeasuredBox | null
}

const within = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const step = (value: number, by: number) => Math.round(value / by) * by
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function type(m: MeasuredType | null | undefined, [min, max]: [number, number]) {
  if (!m) return undefined
  const out: NonNullable<Tune['headline']> = {}
  if (finite(m.size)) out.size = within(Math.round(m.size), min, max)
  if (finite(m.weight)) out.weight = within(step(m.weight, 100), 100, 900)
  // Measured as none, tracking is none: the portal's own default would add some.
  if (finite(m.tracking))
    out.tracking = Math.abs(m.tracking) < 0.005 ? 0 : within(+m.tracking.toFixed(3), -0.1, 0.3)
  if (finite(m.leading)) out.leading = within(+m.leading.toFixed(2), 0.9, 1.8)
  if (m.colour && HEX.test(m.colour)) out.colour = m.colour.toLowerCase()
  return Object.keys(out).length ? out : undefined
}

const HEX = /^#[0-9a-f]{6}$/i

const corners = (radius: number | null | undefined, max: number) =>
  !finite(radius) ? undefined : radius >= 999 ? 999 : within(Math.round(radius), 0, max)

/** The exact values a brand's measurements give. */
export function tuneFromMeasurements(m: BrandMeasurements): Tune {
  const tune: Tune = {}
  // A portal's headline leads a page of content, not a marketing screen: a
  // poster-sized one is held where it still leaves the page room.
  const headline = type(m.headline, [24, 88])
  if (headline) tune.headline = headline
  // A site's section headings introduce a screen; in a portal they title a
  // card over 14-16px content. They keep the brand's face, weight and colour,
  // and take a card title's size: 18px, and a little more the larger the brand
  // sets them, never past 24px. Tight tracking eases at that size.
  const heading = type(m.heading, [16, 200])
  if (heading?.size) heading.size = Math.round(within(18 + (heading.size - 18) * 0.2, 18, 24))
  if (heading?.tracking !== undefined) heading.tracking = Math.max(heading.tracking, -0.01)
  if (heading?.leading) heading.leading = within(heading.leading, 1.15, 1.6)
  // A light weight that carries a 32px heading is too faint at a card title's size.
  if (heading?.weight) heading.weight = Math.max(heading.weight, 400)
  if (heading) tune.heading = heading
  const label = type(m.label, [12, 18])
  if (label) {
    delete label.leading
    delete label.colour
    if (Object.keys(label).length) tune.label = label
  }
  if (m.button) {
    const radius = corners(m.button.radius, 999)
    const height = finite(m.button.height) ? within(Math.round(m.button.height), 28, 60) : undefined
    const button: NonNullable<Tune['button']> = {
      ...(radius !== undefined && { radius }),
      ...(height && { height }),
      ...(m.button.fill && HEX.test(m.button.fill) && { fill: m.button.fill.toLowerCase() }),
      ...(m.button.ink && HEX.test(m.button.ink) && { ink: m.button.ink.toLowerCase() }),
      ...(finite(m.button.weight) && { weight: within(step(m.button.weight, 100), 100, 900) }),
      ...(typeof m.button.upper === 'boolean' && { case: m.button.upper ? 'upper' : 'sentence' }),
    }
    if (Object.keys(button).length) tune.button = button
  }
  if (m.card) {
    tune.card = {
      ...(corners(m.card.radius, 32) !== undefined && { radius: corners(m.card.radius, 32) }),
      ...(finite(m.card.borderWidth) && { border: within(Math.round(m.card.borderWidth), 0, 4) }),
      ...(typeof m.card.shadow === 'boolean' && { shadow: m.card.shadow ? 'soft' : 'none' }),
    }
    if (!Object.keys(tune.card).length) delete tune.card
  }
  const field = corners(m.field?.radius, 999)
  if (field !== undefined) tune.field = { radius: field }
  return tune
}
