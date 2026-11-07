/**
 * The faithful look keeps the brand's colours as they were seen. A colour the
 * model names is taken only where the colours measured from what was seen
 * bear it out.
 */
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'

const oklchOf = (colour: string) =>
  /^#[0-9a-f]{6}$/i.test(colour) ? parseOklch(hexToOklch(colour)) : null

const lab = (colour: string) => {
  const c = oklchOf(colour)
  return c
    ? [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)]
    : null
}

/**
 * Whether a colour is borne out by what was seen: near one of the colours
 * measured from it. A model can misread a colour, such as one dimmed by an
 * overlay, and then it must not reach the design.
 */
export function confirmedBy(seen: readonly string[]): (colour: string) => boolean {
  const points = seen.map(lab).filter((p): p is number[] => !!p)
  return (colour) => {
    const p = lab(colour)
    if (!p) return false
    return points.some((q) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) < 0.09)
  }
}
