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
}

export interface MeasuredBox {
  /** In px; 999 or more is a pill. */
  radius?: number | null
  height?: number
  borderWidth?: number
  shadow?: boolean
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
  return Object.keys(out).length ? out : undefined
}

const corners = (radius: number | null | undefined, max: number) =>
  !finite(radius) ? undefined : radius >= 999 ? 999 : within(Math.round(radius), 0, max)

/** The exact values a brand's measurements give. */
export function tuneFromMeasurements(m: BrandMeasurements): Tune {
  const tune: Tune = {}
  const headline = type(m.headline, [24, 120])
  if (headline) tune.headline = headline
  // A site's section headings are often heroes of their own; in a portal they
  // title a card, so they are held to what a card can carry.
  const heading = type(m.heading, [16, 36])
  if (heading) tune.heading = heading
  const label = type(m.label, [12, 18])
  if (label) {
    delete label.leading
    tune.label = label
  }
  if (m.button) {
    const radius = corners(m.button.radius, 999)
    const height = finite(m.button.height) ? within(Math.round(m.button.height), 28, 60) : undefined
    if (radius !== undefined || height !== undefined)
      tune.button = { ...(radius !== undefined && { radius }), ...(height && { height }) }
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
