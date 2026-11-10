/**
 * What the loop checks after it acts: what was drawn, compared with what the
 * request asked. A check names an element in a state, a property and what is
 * expected of it ("buttons on hover: background darker than at rest"); it is
 * judged on readings of the drawn preview, with a measurable margin, and
 * said in plain words either way. A check on something the page checked does
 * not show is neither met nor failed: it is said as not seen.
 */
import { contrastRatio } from '../contrast'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import { composite, lightness, parseCssColour, px, shadowStrength, type Colour } from './css-values'
import {
  propertyOf,
  targetKey,
  targetWords,
  type StyleRegistry,
  type StyleTarget,
} from './style-registry'

/** One element as drawn: its computed values by property id, and the colour behind it. */
export interface ElementReading {
  found: boolean
  values: Record<string, string>
  /** The opaque colour it sits on, for contrast; null when not known. */
  behind: string | null
}

/** Readings by target key (style-registry targetKey). */
export type Readings = Record<string, ElementReading>

export const EXPECTS = [
  'is',
  'darker',
  'lighter',
  'more',
  'less',
  'present',
  'none',
  'subtle',
  'strong',
  'readable',
  'dark',
  'light',
  'changed',
] as const
export type Expect = (typeof EXPECTS)[number]

export interface StyleCheck extends StyleTarget {
  property: string
  expect: Expect
  /**
   * For is, the value; for darker, lighter, more and less, what it is
   * compared with: "before" (the design before the request) or "base" (the
   * element at rest), and base by default for a state other than base; for
   * readable, the least contrast ratio.
   */
  value: string
}

export interface CheckResult {
  check: StyleCheck
  /** Met, failed, or null when the page checked does not show it. */
  ok: boolean | null
  /** What was seen, in words. */
  saw: string
}

/** The least lightness step that reads as darker or lighter. */
export const LIGHTNESS_STEP = 0.03

const round = (n: number, places = 2) => +n.toFixed(places)

function colourOf(reading: ElementReading, property: string): Colour | null {
  return parseCssColour(reading.values[property])
}

/** A colour as it shows: over what is behind it when translucent. */
function shown(reading: ElementReading, property: string): string | null {
  const colour = colourOf(reading, property)
  if (!colour) return null
  if (colour.alpha >= 0.999) return colour.hex
  const under = property === 'background' ? reading.behind : shownBackground(reading)
  return under ? composite(colour, under) : colour.alpha > 0.5 ? colour.hex : null
}

/** The background a text colour sits on: the element's own fill over what is behind it. */
function shownBackground(reading: ElementReading): string | null {
  const fill = colourOf(reading, 'background')
  if (fill && fill.alpha > 0) return reading.behind ? composite(fill, reading.behind) : fill.hex
  return reading.behind
}

function oklabDistance(a: string, b: string): number {
  const lab = (hex: string) => {
    const p = parseOklch(hexToOklch(hex))!
    const rad = (p.h * Math.PI) / 180
    return [p.l, p.c * Math.cos(rad), p.c * Math.sin(rad)]
  }
  const [x, y] = [lab(a), lab(b)]
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!)
}

/** A number a property reads as, for more and less. */
function amount(reading: ElementReading, property: string): number | null {
  const value = reading.values[property]
  if (property === 'shadow') {
    const s = shadowStrength(value)
    return s.present ? s.alpha * (s.blur + s.offset + 1) : 0
  }
  if (property === 'lift') {
    // translate: "0px -2px" rises 2px.
    const parts = (value ?? '').split(/\s+/).map(parseFloat)
    return parts.length > 1 ? Math.max(0, -(parts[1] ?? 0)) : 0
  }
  if (property === 'weight') return value ? Number(value) : null
  if (property === 'tracking') {
    if (value === 'normal') return 0
    const size = px(reading.values.size)
    const n = px(value)
    return n === null ? null : size ? n / size : n
  }
  return px(value)
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/** The reading a relative check compares with. */
function reference(
  check: StyleCheck,
  now: Readings,
  before: Readings | null
): { reading: ElementReading | null; as: string } {
  // At rest, "base" would compare the element with itself: it means before.
  const wantBefore = check.value === 'before' || check.state === 'base'
  if (wantBefore) return { reading: before?.[targetKey(check)] ?? null, as: 'before' }
  return { reading: now[targetKey({ ...check, state: 'base' })] ?? null, as: 'at rest' }
}

const is = (registry: StyleRegistry, check: StyleCheck, r: ElementReading): [boolean, string] => {
  const property = propertyOf(registry, check.property)
  const value = r.values[check.property] ?? ''
  const want = check.value.trim().toLowerCase()
  if (property?.kind === 'colour') {
    const got = shown(r, check.property)
    const target = parseCssColour(want)
    if (!got || !target) return [false, `${check.property} ${value || 'unreadable'}`]
    return [oklabDistance(got, target.hex) < 0.04, `${check.property} ${got}`]
  }
  if (property?.kind === 'shadow') {
    const s = shadowStrength(value)
    const ok =
      want === 'none'
        ? !s.present
        : want === 'subtle' || want === 'soft'
          ? s.present && s.alpha <= 0.12 && s.blur <= 6
          : want === 'strong' || want === 'deep' || want === 'floating'
            ? s.present && (s.alpha >= 0.14 || s.blur >= 12)
            : s.present
    return [ok, s.present ? `shadow at ${pct(s.alpha)} opacity, ${s.blur}px blur` : 'no shadow']
  }
  if (property?.kind === 'choice') {
    // CSS reads upper as uppercase, lower as lowercase.
    const css = want === 'upper' ? 'uppercase' : want === 'lower' ? 'lowercase' : want
    return [value.includes(css), `${check.property} ${value}`]
  }
  const got = amount(r, check.property)
  const target = parseFloat(want)
  if (got === null || Number.isNaN(target)) return [false, `${check.property} ${value}`]
  const tolerance =
    property?.kind === 'weight' ? 50 : property?.kind === 'em' ? 0.006 : Math.max(1, target * 0.03)
  const pill = check.property === 'radius' && target >= 99 && got >= 99
  return [pill || Math.abs(got - target) <= tolerance, `${check.property} ${round(got, 3)}`]
}

/** Judges one check on the readings: now, and before the request when one compares with it. */
export function evaluateCheck(
  registry: StyleRegistry,
  check: StyleCheck,
  now: Readings,
  before: Readings | null
): CheckResult {
  const words = targetWords(registry, check)
  const r = now[targetKey(check)]
  if (!r?.found) return { check, ok: null, saw: `${words}: not on the page checked` }
  const say = (ok: boolean, saw: string): CheckResult => ({ check, ok, saw: `${words}: ${saw}` })
  switch (check.expect) {
    case 'is': {
      const [ok, saw] = is(registry, check, r)
      return say(ok, `${saw}${ok ? '' : `, not ${check.value}`}`)
    }
    case 'darker':
    case 'lighter': {
      const ref = reference(check, now, before)
      const a = shown(r, check.property)
      const b = ref.reading?.found ? shown(ref.reading, check.property) : null
      if (!a) return say(false, `${check.property} unreadable`)
      if (!b) return { check, ok: null, saw: `${words}: nothing ${ref.as} to compare with` }
      const step = lightness(b) - lightness(a)
      const by = check.expect === 'darker' ? step : -step
      const ok = by >= LIGHTNESS_STEP
      return say(
        ok,
        `${check.property} ${a} is ${ok ? `${pct(Math.abs(step))} ${check.expect}` : by > 0 ? `only ${pct(by)} ${check.expect}` : `not ${check.expect}`} than ${ref.as} (${b})`
      )
    }
    case 'more':
    case 'less': {
      const ref = reference(check, now, before)
      const a = amount(r, check.property)
      const b = ref.reading?.found ? amount(ref.reading, check.property) : null
      if (a === null) return say(false, `${check.property} unreadable`)
      if (b === null) return { check, ok: null, saw: `${words}: nothing ${ref.as} to compare with` }
      const ok = check.expect === 'more' ? a > b + 1e-6 : a < b - 1e-6
      return say(ok, `${check.property} ${round(a, 3)} against ${round(b, 3)} ${ref.as}`)
    }
    case 'present':
    case 'none': {
      const value = r.values[check.property] ?? ''
      let present: boolean
      if (check.property === 'shadow') present = shadowStrength(value).present
      else if (check.property === 'borderWidth') present = (px(value) ?? 0) > 0
      else if (check.property === 'underline') present = value.includes('underline')
      else if (check.property === 'lift') present = (amount(r, 'lift') ?? 0) > 0
      else present = (colourOf(r, check.property)?.alpha ?? 0) > 0
      const ok = check.expect === 'present' ? present : !present
      return say(ok, `${check.property} ${present ? 'present' : 'none'} (${value || 'none'})`)
    }
    case 'subtle':
    case 'strong': {
      if (check.property === 'shadow') {
        const s = shadowStrength(r.values.shadow)
        const ok =
          check.expect === 'subtle'
            ? s.present && s.alpha <= 0.2 && s.blur <= 16
            : s.present && (s.alpha >= 0.15 || s.blur >= 12)
        return say(
          ok,
          s.present ? `shadow at ${pct(s.alpha)} opacity, ${s.blur}px blur` : 'no shadow'
        )
      }
      const colour = shown(r, check.property)
      const behind = check.property === 'background' ? r.behind : shownBackground(r)
      if (!colour || !behind) return say(false, `${check.property} unreadable`)
      const ratio = contrastRatio(colour, behind)
      const ok = check.expect === 'subtle' ? ratio <= 1.8 : ratio >= 3
      return say(ok, `${check.property} ${colour} at ${round(ratio)}:1 against ${behind}`)
    }
    case 'readable': {
      const fg = shown(r, 'color')
      const bg = shownBackground(r)
      if (!fg || !bg) return { check, ok: null, saw: `${words}: colours unreadable` }
      const least = parseFloat(check.value) || (check.element === 'headline' ? 3 : 4.5)
      const ratio = contrastRatio(fg, bg)
      return say(
        ratio >= least,
        `text ${fg} on ${bg} reads ${round(ratio, 1)}:1 (needs ${least}:1)`
      )
    }
    case 'dark':
    case 'light': {
      const colour = shown(r, check.property)
      if (!colour) return say(false, `${check.property} unreadable`)
      const l = lightness(colour)
      return say(check.expect === 'dark' ? l < 0.35 : l > 0.85, `${check.property} ${colour}`)
    }
    case 'changed': {
      const was = before?.[targetKey(check)]
      if (!was?.found) return { check, ok: null, saw: `${words}: nothing before to compare with` }
      const a = r.values[check.property]
      const b = was.values[check.property]
      return say(a !== b, `${check.property} ${b} → ${a}`)
    }
  }
}

/**
 * The checks every styled colour brings without being asked: text that
 * still reads where a fill or a text colour was styled.
 */
export function readabilityChecks(
  styles: ReadonlyArray<StyleTarget & { property: string }>
): StyleCheck[] {
  const seen = new Set<string>()
  const out: StyleCheck[] = []
  for (const style of styles) {
    if (!['background', 'color'].includes(style.property)) continue
    if (style.element === 'page') continue
    const key = targetKey(style)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      element: style.element,
      state: style.state,
      block: style.block,
      ...(style.target ? { target: style.target } : {}),
      property: 'color',
      expect: 'readable',
      value: '',
    })
  }
  return out
}

/** Checks without repeats. */
export function uniqueChecks(checks: readonly StyleCheck[]): StyleCheck[] {
  const seen = new Set<string>()
  return checks.filter((check) => {
    const key = `${targetKey(check)}|${check.property}|${check.expect}|${check.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
