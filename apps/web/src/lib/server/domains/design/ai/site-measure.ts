/**
 * A brand's type and shapes, measured from its page's HTML and CSS without a
 * browser: the headline, a section heading, the main button, a card and a
 * field are found in the HTML, and the rules whose selectors match them are
 * applied in cascade order, utility classes included. Sizes resolve rem,
 * clamp(), min(), max(), viewport units at a wide screen and custom properties,
 * which inherit down the page's elements as a browser's do.
 * Rules for small screens and dark themes are left out. What cannot be read is
 * left unmeasured rather than guessed.
 */
import type {
  BrandMeasurements,
  MeasuredBox,
  MeasuredType,
} from '@/lib/shared/design/measured-tune'
import { cascade, indexRules, inlineStyle, parseRules, type RuleIndex } from './css-cascade'
import { pageTree, type PageNode } from './page-tree'
import { hex } from './site-brand'

const ROOT_PX = 16
const VIEWPORT = 1440
const VIEWPORT_HEIGHT = 900
const INHERITED = ['color', 'font-weight', 'letter-spacing', 'text-transform'] as const

/** The page's custom properties at its root. Elements below inherit and override them. */
function rootProperties(rules: ReturnType<typeof parseRules>): Map<string, string> {
  const props = new Map<string, string>()
  for (const rule of rules)
    if (rule.selectors.some((s) => /^(:root|html|body)$/i.test(s)))
      for (const [k, v] of rule.decls) if (k.startsWith('--')) props.set(k, v)
  return props
}

function resolveVars(value: string, props: Map<string, string>, depth = 0): string {
  if (depth > 6) return value
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
    (_, name: string, fallback?: string) =>
      resolveVars(props.get(name) ?? fallback ?? '', props, depth + 1)
  )
}

/** A length in px at a wide screen, or null when it cannot be read. */
function length(raw: string | undefined, props: Map<string, string>, em = ROOT_PX): number | null {
  if (!raw) return null
  const value = resolveVars(raw, props).trim()
  const fn = /^(clamp|min|max)\((.*)\)$/i.exec(value)
  if (fn) {
    const args = splitArgs(fn[2]!).map((a) => length(a, props, em))
    if (args.some((a) => a === null))
      return fn[1]!.toLowerCase() === 'clamp' ? (args[2] ?? null) : null
    const nums = args as number[]
    if (fn[1]!.toLowerCase() === 'clamp') return Math.min(Math.max(nums[1]!, nums[0]!), nums[2]!)
    return fn[1]!.toLowerCase() === 'min' ? Math.min(...nums) : Math.max(...nums)
  }
  const calc = /^calc\((.*)\)$/i.exec(value)
  if (calc) {
    const terms = calc[1]!.split(/\s+([+-])\s+/)
    let total = length(terms[0], props, em)
    for (let i = 1; i < terms.length && total !== null; i += 2) {
      const next = length(terms[i + 1], props, em)
      total = next === null ? null : terms[i] === '+' ? total + next : total - next
    }
    return total
  }
  const unit = /^(-?[\d.]+)(px|rem|em|vw|[sld]?vh|vmin|vmax|%)?$/i.exec(value)
  if (!unit) return null
  const n = parseFloat(unit[1]!)
  switch ((unit[2] ?? '').toLowerCase()) {
    case 'px':
      return n
    case 'rem':
      return n * ROOT_PX
    case 'em':
      return n * em
    case 'vw':
      return (n * VIEWPORT) / 100
    case 'vh':
    case 'svh':
    case 'lvh':
    case 'dvh':
      return (n * VIEWPORT_HEIGHT) / 100
    case 'vmin':
      return (n * Math.min(VIEWPORT, VIEWPORT_HEIGHT)) / 100
    case 'vmax':
      return (n * Math.max(VIEWPORT, VIEWPORT_HEIGHT)) / 100
    case '':
      return n === 0 ? 0 : null
    default:
      return null
  }
}

function splitArgs(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) {
      out.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(text.slice(start).trim())
  return out
}

const WEIGHTS: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 800 }

/** The longhands a font shorthand sets: its weight, size and line height. */
function expandFont(decls: Map<string, string>, props: Map<string, string>) {
  const font = decls.get('font') && resolveVars(decls.get('font')!, props)
  if (!font) return decls
  const out = new Map(decls)
  const m =
    /(?:^|\s)(\d{3}|bold|bolder|lighter|normal)?\s*(?:italic|oblique)?\s*(?:\d{3}|bold)?\s*([\d.]+(?:px|rem|em|vw|%))(?:\s*\/\s*([\d.]+(?:px|rem|em|%)?))?/i.exec(
      font
    )
  const weight = /(?:^|\s)(\d{3}|bold|bolder|lighter)(?=\s)/i.exec(font)?.[1]
  if (m?.[2] && !decls.has('font-size')) out.set('font-size', m[2])
  if (!decls.has('line-height')) out.set('line-height', m?.[3] ?? 'normal')
  if (!decls.has('font-weight')) out.set('font-weight', weight ?? 'normal')
  return out
}

function typeOf(decls: Map<string, string>, props: Map<string, string>): MeasuredType | null {
  const size = length(decls.get('font-size'), props)
  if (!size) return null
  const rawWeight = decls.get('font-weight') && resolveVars(decls.get('font-weight')!, props).trim()
  const weight = rawWeight ? (WEIGHTS[rawWeight] ?? (Number(rawWeight) || undefined)) : undefined
  const spacing = decls.get('letter-spacing')
  const tracking = spacing
    ? /em$/.test(resolveVars(spacing, props).trim())
      ? parseFloat(resolveVars(spacing, props))
      : (length(spacing, props, size) ?? 0) / size
    : undefined
  const lh = decls.get('line-height') && resolveVars(decls.get('line-height')!, props).trim()
  const leading =
    !lh || lh === 'normal'
      ? undefined
      : /^[\d.]+$/.test(lh)
        ? parseFloat(lh)
        : /%$/.test(lh)
          ? parseFloat(lh) / 100
          : (length(lh, props, size) ?? NaN) / size
  const colour = decls.get('color') && hex(resolveVars(decls.get('color')!, props))
  return {
    size,
    ...(weight && { weight }),
    ...(colour && { colour }),
    ...(tracking !== undefined && Number.isFinite(tracking) && { tracking }),
    ...(leading !== undefined && Number.isFinite(leading) && { leading }),
  }
}

function boxOf(decls: Map<string, string>, props: Map<string, string>): MeasuredBox | null {
  const radiusRaw = decls.get('border-radius')?.split(/\s+/)[0]
  const radius = radiusRaw && /^(50%|100%)$/.test(radiusRaw.trim()) ? 999 : length(radiusRaw, props)
  const height = length(decls.get('min-height') ?? decls.get('height'), props)
  const border = decls.get('border-width') ?? /^([\d.]+px)\b/.exec(decls.get('border') ?? '')?.[1]
  const shadow = decls.get('box-shadow')
  const background = decls.get('background-color') ?? decls.get('background')
  const fill = background && hex(resolveVars(background, props).split(/\s+(?![^(]*\))/)[0] ?? '')
  const ink = decls.get('color') && hex(resolveVars(decls.get('color')!, props))
  const rawWeight = decls.get('font-weight') && resolveVars(decls.get('font-weight')!, props).trim()
  const weight = rawWeight ? (WEIGHTS[rawWeight] ?? (Number(rawWeight) || undefined)) : undefined
  const transform = decls.get('text-transform')?.trim().toLowerCase()
  const out: MeasuredBox = {
    ...(radius !== null && radius !== undefined && { radius: radius >= 500 ? 999 : radius }),
    ...(height && height > 0 && { height }),
    ...(border !== undefined &&
      length(border, props) !== null && { borderWidth: length(border, props)! }),
    ...(shadow !== undefined && { shadow: !/^none$/i.test(shadow.trim()) }),
    ...(fill && { fill }),
    ...(ink && { ink }),
    ...(weight && { weight }),
    ...(transform && { upper: transform === 'uppercase' }),
  }
  return Object.keys(out).length ? out : null
}

/** An element the page keeps out of sight: hidden, for screen readers only, or a notice over it. */
const hiddenItself = (el: PageNode) =>
  /(^|\s)hidden(\s|=|$)|aria-hidden\s*=\s*["']true|display\s*:\s*none/i.test(el.attrs) ||
  [...el.classes].some((c) =>
    /(sr-only|visually-hidden|screen-reader|cookie|consent|modal|dialog|onetrust)/i.test(c)
  ) ||
  /\bid\s*=\s*["'][^"']*(cookie|consent|onetrust)/i.test(el.attrs)

/** What a page asks its visitors to do first: the words of a main call to action. */
const CALL_TO_ACTION =
  /^(get( \w+)?( started| free| the app| a demo| \w+ free)?|start\b|sign ?up|try\b|join\b|buy\b|shop\b|book\b|send\b|download\b|request\b|contact sales|create\b|open (an )?account|subscribe\b|learn more)/i
/** Consent and cookie notices, whose buttons are not the brand's. */
const NOTICE =
  /(accept|reject|decline|cookie|consent|preferences|customi[sz]e|agree|allow all|got it)/i
/** Signing in is offered beside the call to action, seldom as it. */
const SIGN_IN = /^(log ?in|sign ?in|my account)$/i

interface Candidate {
  index: number
  text: string
  /** How far into the page it sits, 0 at the top. */
  at: number
  buttonish: boolean
}

/** The page's visible links and buttons with their words and place, notices left out. */
function candidates(nodes: PageNode[], hidden: (index: number) => boolean): Candidate[] {
  const out: Candidate[] = []
  nodes.forEach((node, index) => {
    const text = node.text
    if (!text || text.length > 40 || NOTICE.test(text) || hidden(index) || out.length > 300) return
    out.push({ index, text, at: node.at, buttonish: isButtonish(node) })
  })
  return out
}

/** How likely a candidate is the page's main call to action. */
function intent(c: Candidate): number {
  return (
    (CALL_TO_ACTION.test(c.text) ? 3 : 0) +
    (c.buttonish ? 1 : 0) +
    (c.at < 0.35 ? 2 : c.at < 0.6 ? 1 : 0) -
    (SIGN_IN.test(c.text) ? 3 : 0)
  )
}

const isButtonish = (el: PageNode) =>
  (el.tag === 'a' || el.tag === 'button') &&
  ([...el.classes].some((c) => /(^|[-_])(btn|button|cta)([-_]|$)/i.test(c)) ||
    /role\s*=\s*["']button/i.test(el.attrs)) &&
  ![...el.classes].some((c) => /(close|icon|menu|toggle|skip|cookie|link)/i.test(c))

/**
 * A page's type and shapes, as far as its HTML and CSS say. The headline is
 * the largest h1 in sight, and the main button the one filled with the site's
 * own button colour when one is known.
 */
export function measureSite(
  html: string,
  css: string[],
  brandButton: string | null = null
): BrandMeasurements {
  const rules = parseRules(css.join('\n'))
  const root = rootProperties(rules)
  // A shorthand sets its longhands where its own rule does not, so the cascade weighs them by rule.
  for (const rule of rules) rule.decls = expandFont(rule.decls, root)
  const index: RuleIndex = indexRules(rules)
  const nodes = pageTree(html)
  const declsAt = memo((i) => cascade(index, nodes[i]!, inlineStyle(nodes[i]!.attrs)))
  // Custom properties inherit: each element's are its parent's, with its own over them.
  // Sites keep a theme's colours on a wrapper as often as on the root.
  const propsAt: (i: number) => Map<string, string> = memo((i) => {
    const parent = nodes[i]!.parent < 0 ? root : propsAt(nodes[i]!.parent)
    const own = [...declsAt(i)].filter(([k]) => k.startsWith('--'))
    return own.length ? new Map([...parent, ...own]) : parent
  })
  const hidden: (i: number) => boolean = memo(
    (i) => hiddenItself(nodes[i]!) || (nodes[i]!.parent >= 0 && hidden(nodes[i]!.parent))
  )
  // Colour and the type's weight, tracking and case inherit as their values where set.
  const styleAt: (i: number) => Map<string, string> = memo((i) => {
    const own = declsAt(i)
    const parent = nodes[i]!.parent
    if (parent < 0) return own
    const above = styleAt(parent)
    const out = new Map(own)
    for (const key of INHERITED)
      if (!out.has(key) && above.has(key))
        out.set(key, resolveVars(above.get(key)!, propsAt(parent)))
    return out
  })
  const typeAt = (i: number) => typeOf(styleAt(i), propsAt(i))
  const boxAt = (i: number) => boxOf(styleAt(i), propsAt(i))
  const visible = nodes.map((_, i) => i).filter((i) => !hidden(i))
  const first = (pick: (el: PageNode, i: number) => boolean) =>
    visible.find((i) => pick(nodes[i]!, i))
  // The headline is the largest h1 in sight, unless display text near the top
  // is much larger: a site may mark a small label up as an h1, or keep its h1
  // for screen readers and show the hero in another element.
  const largest = (picks: number[]) =>
    picks
      .map((i) => typeAt(i))
      .filter((t) => !!t?.size)
      .sort((a, b) => (b?.size ?? 0) - (a?.size ?? 0))[0]
  const h1 = largest(visible.filter((i) => nodes[i]!.tag === 'h1').slice(0, 12))
  const display = largest(
    visible
      .filter(
        (i) => nodes[i]!.at < 0.3 && !!nodes[i]!.worded && !/^(a|button|label)$/.test(nodes[i]!.tag)
      )
      .slice(0, 300)
  )
  const headline = h1 && (!display || (h1.size ?? 0) >= (display.size ?? 0) * 0.7) ? h1 : display
  const h2 = first((el, i) => el.tag === 'h2' && !!typeAt(i))
  // The main button is the call to action the page leads with: its words, its
  // place near the top and its styling, among those whose fill can be read. A
  // known button colour from the site's CSS breaks a tie. A call to action in
  // words near the top is evidence enough to lead with.
  const filled = (i: number) => boxAt(i)?.fill
  const ranked = candidates(nodes, hidden)
    .map((c) => ({ c, fill: filled(c.index), score: intent(c) }))
    .filter((x) => !!x.fill && x.score >= 4)
    .sort(
      (a, b) => b.score - a.score || Number(b.fill === brandButton) - Number(a.fill === brandButton)
    )
  const buttons = visible.filter((i) => isButtonish(nodes[i]!)).slice(0, 20)
  const button =
    ranked[0]?.c.index ??
    (brandButton && buttons.find((i) => filled(i) === brandButton)) ??
    buttons.find((i) => !!filled(i)) ??
    buttons[0]
  const card = first((el) => [...el.classes].some((c) => /(^|[-_])card([-_]|$)/i.test(c)))
  const field = first(
    (el) => el.tag === 'input' && !/type\s*=\s*["'](hidden|checkbox|radio|submit)/i.test(el.attrs)
  )
  const box = button === undefined ? null : boxAt(button)
  return {
    headline: headline ?? null,
    heading: h2 === undefined ? null : typeAt(h2),
    button: box && ranked[0] ? { ...box, action: true } : box,
    card: card === undefined ? null : boxAt(card),
    field: field === undefined ? null : boxAt(field),
  }
}

/** A function of an element's index, worked out once per element. */
function memo<T>(work: (i: number) => T): (i: number) => T {
  const done = new Map<number, T>()
  return (i) => {
    if (!done.has(i)) done.set(i, work(i))
    return done.get(i)!
  }
}
