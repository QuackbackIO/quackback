/**
 * A page's brand fingerprint and how close two are: the rendered styles of
 * the elements a brand is recognised by, read by role (headline, section
 * heading, body, nav link, primary button, card, field, page background),
 * and a 0 to 100 score of one against another.
 *
 * The score is the evaluation rig's (score.py), ported exactly so a number in
 * the product means what it means on the rig: per role, a weighted mean of
 * its properties (family name, size as a log ratio, weight, tracking,
 * leading, case and colour in OKLab for type; fill, ink, radius, height,
 * weight, case, size and shadow for boxes), then a weighted mean of the
 * roles and the page colour.
 *
 * One addition for targets measured from screenshots, which know only some
 * properties: a property the target leaves out is not scored (the rig's
 * fingerprints always carry every property, so parity holds there).
 *
 * Pure: no imports, so the browser, the server and the rig can all load it.
 */

export interface TypeStyle {
  family?: string
  size?: number
  weight?: number
  /** Letter-spacing in em. */
  tracking?: number
  /** Line height over size. */
  leading?: number
  transform?: string
  color?: string
}

export interface BoxStyle {
  bg?: string
  color?: string
  /** Corner radius in px; 999 for fully round. */
  radius?: number
  height?: number
  borderWidth?: number
  borderColor?: string
  shadow?: boolean
  size?: number
  weight?: number
  transform?: string
  family?: string
  padX?: number
}

export interface Fingerprint {
  page?: string | null
  headline?: TypeStyle | null
  heading?: TypeStyle | null
  body?: TypeStyle | null
  link?: TypeStyle | null
  button?: BoxStyle | null
  buttonText?: string | null
  card?: BoxStyle | null
  field?: BoxStyle | null
}

export const FINGERPRINT_ROLES = [
  'headline',
  'heading',
  'body',
  'link',
  'button',
  'card',
  'field',
] as const
export type FingerprintRole = (typeof FINGERPRINT_ROLES)[number]

type Lab = readonly [number, number, number]

const nums = (s: string, re: RegExp) => (s.match(re) ?? []).map(Number)

/** A CSS colour (rgb, rgba, oklch, oklab) in OKLab; null when unreadable or nearly transparent. */
export function toOklab(c: string | null | undefined): Lab | null {
  const s = c ?? ''
  if (s.startsWith('oklch(')) {
    const n = nums(s, /[\d.]+/g).slice(0, 3)
    if (n.length < 3) return null
    const [l, ch, h] = n as [number, number, number]
    const rad = (h * Math.PI) / 180
    return [l, ch * Math.cos(rad), ch * Math.sin(rad)]
  }
  if (s.startsWith('oklab(')) {
    const n = nums(s, /-?[\d.]+/g)
    return n.length >= 3 ? [n[0]!, n[1]!, n[2]!] : null
  }
  const m = nums(s, /[\d.]+/g)
  if (m.length < 3) return null
  const a = m.length > 3 ? m[3]! : 1
  if (a < 0.05) return null
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = m.slice(0, 3).map((v) => lin(v / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}

/** `#rrggbb` as the `rgb()` a browser reports, so a target and a reading compare alike. */
export function hexToRgb(hex: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return null
  return `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})`
}

type Value = string | number | boolean | null | undefined
type Compare = (target: Value, actual: Value) => number | null

const colour: Compare = (a, b) => {
  const A = toOklab(a as string)
  const B = toOklab(b as string)
  if (!A || !B) return null
  return Math.max(0, 1 - Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) / 0.25)
}

const names = (s: Value) =>
  String(s ?? '')
    .split(',')
    .slice(0, 3)
    .map((n) =>
      n
        .toLowerCase()
        .replaceAll('variable', '')
        .replaceAll('var', '')
        .replace(/[^a-z]/g, '')
    )

/** The actual's first family named among the target's first three. */
const family: Compare = (a, b) => {
  const first = names(b)[0] ?? ''
  return first && names(a).includes(first) ? 1 : 0
}

const size: Compare = (a, b) =>
  a && b ? Math.max(0, 1 - Math.abs(Math.log(Number(a) / Number(b))) / Math.LN2) : null

const lin =
  (span: number): Compare =>
  (a, b) =>
    a === null || a === undefined || b === null || b === undefined
      ? null
      : Math.max(0, 1 - Math.abs(Number(a) - Number(b)) / span)

const same: Compare = (a, b) => (a === b ? 1 : 0)

const radius: Compare = (x, y) => {
  if (x === null || x === undefined || y === null || y === undefined) return null
  const a = Number(x)
  const b = Number(y)
  if (a >= 999 === b >= 999 && (a >= 999 || Math.abs(a - b) <= 2)) return 1
  return a < 999 && b < 999
    ? Math.max(0, 1 - Math.abs(Math.min(a, 40) - Math.min(b, 40)) / 16)
    : 0.2
}

type Props = Record<string, [Compare, number]>

const TYPE: Props = {
  family: [family, 3],
  size: [size, 2],
  weight: [lin(400), 2],
  tracking: [lin(0.05), 1],
  leading: [lin(0.5), 1],
  transform: [same, 1],
  color: [colour, 2],
}
const BOX: Props = {
  bg: [colour, 3],
  color: [colour, 1],
  radius: [radius, 2],
  height: [lin(24), 1],
  weight: [lin(400), 1],
  transform: [same, 1],
  size: [size, 1],
  shadow: [same, 1],
}
const ROLES: Record<FingerprintRole, [Props, number]> = {
  headline: [TYPE, 4],
  heading: [TYPE, 2],
  body: [TYPE, 2],
  link: [TYPE, 1],
  button: [BOX, 3],
  card: [{ radius: [radius, 2], shadow: [same, 1], bg: [colour, 1], borderWidth: [lin(2), 1] }, 2],
  field: [{ radius: [radius, 2], height: [lin(24), 1], bg: [colour, 1] }, 1],
}
const PAGE_WEIGHT = 2

/** A property that scored under this is a gap worth naming. */
export const GAP_UNDER = 0.75

export interface FingerprintGap {
  role: FingerprintRole | 'page'
  prop: string
  target: Value
  actual: Value
  /** 0 to 1. */
  match: number
}

export interface FingerprintScore {
  /** 0 to 100, unrounded; null when nothing could be compared. */
  score: number | null
  /** Each role's own match, 0 to 1. */
  roles: Partial<Record<FingerprintRole | 'page', number>>
  /** Properties under GAP_UNDER, worst first. */
  gaps: FingerprintGap[]
}

const present = (o: object | null | undefined): o is Record<string, Value> =>
  !!o && Object.keys(o).length > 0

/** How close `actual` is to `target`, as the rig scores a portal against its brand's site. */
export function scoreFingerprint(target: Fingerprint, actual: Fingerprint): FingerprintScore {
  let total = 0
  let weight = 0
  const roles: FingerprintScore['roles'] = {}
  const gaps: FingerprintGap[] = []
  for (const role of FINGERPRINT_ROLES) {
    const [props, w] = ROLES[role]
    const s = target[role]
    const p = actual[role]
    if (!present(s) || !present(p)) continue
    let num = 0
    let den = 0
    for (const [prop, [fn, pw]] of Object.entries(props)) {
      // A target that does not know a property leaves it out (see the header).
      if (s[prop] === undefined) continue
      const v = fn(s[prop], p[prop])
      if (v === null) continue
      num += v * pw
      den += pw
      if (v < GAP_UNDER) gaps.push({ role, prop, target: s[prop], actual: p[prop], match: v })
    }
    if (den) {
      roles[role] = num / den
      total += (num / den) * w
      weight += w
    }
  }
  const pg = colour(target.page, actual.page)
  if (pg !== null) {
    roles.page = pg
    total += pg * PAGE_WEIGHT
    weight += PAGE_WEIGHT
    if (pg < GAP_UNDER)
      gaps.push({ role: 'page', prop: 'bg', target: target.page, actual: actual.page, match: pg })
  }
  gaps.sort((a, b) => a.match - b.match)
  return { score: weight ? (100 * total) / weight : null, roles, gaps }
}
