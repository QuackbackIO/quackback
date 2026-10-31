/**
 * A brand's type and shapes, measured from its page's HTML and CSS without a
 * browser: the headline, a section heading, the main button, a card and a
 * field are found in the HTML, and the rules whose selectors match them are
 * applied in cascade order, utility classes included. Sizes resolve rem,
 * clamp(), min(), max(), vw at a wide screen and the page's custom properties.
 * Rules for small screens and dark themes are left out. What cannot be read is
 * left unmeasured rather than guessed.
 */
import type {
  BrandMeasurements,
  MeasuredBox,
  MeasuredType,
} from '@/lib/shared/design/measured-tune'
import { hex } from './site-brand'

interface Rule {
  selectors: string[]
  decls: Map<string, string>
  order: number
}

const ROOT_PX = 16
const VIEWPORT = 1440

/** Rules at the top level and in queries that hold on a wide, light screen. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = []
  let order = 0
  const walk = (text: string, skip: boolean) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const prelude = text
        .slice(i, open)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
      // Find the matching close brace.
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      if (prelude.startsWith('@')) {
        const at = prelude.toLowerCase()
        const narrow =
          /max-width|prefers-color-scheme:\s*dark|print|hover:\s*none|pointer:\s*coarse/.test(at)
        if (/^@(media|supports|layer|container)/.test(at)) walk(body, skip || narrow)
      } else if (!skip && prelude) {
        const decls = new Map<string, string>()
        for (const part of body.split(';')) {
          const colon = part.indexOf(':')
          if (colon < 0) continue
          decls.set(
            part.slice(0, colon).trim().toLowerCase(),
            part
              .slice(colon + 1)
              .replace(/!important/i, '')
              .trim()
          )
        }
        rules.push({ selectors: prelude.split(',').map((s) => s.trim()), decls, order: order++ })
      }
      i = j
    }
  }
  walk(css, false)
  return rules
}

interface Element {
  tag: string
  id: string | null
  classes: Set<string>
}

const DYNAMIC =
  /:(hover|focus|active|visited|focus-visible|focus-within|disabled|checked|before|after|placeholder|not|has|is|where|nth|first|last|only|empty|target|selection)/

/** The specificity of a selector's last compound when it matches, or null. */
function matches(selector: string, el: Element): [number, number, number] | null {
  // States, attribute scopes such as a theme, and dark themes are not the page as it first shows.
  if (DYNAMIC.test(selector) || selector.includes('[') || /\.(dark|theme-dark)\b/i.test(selector))
    return null
  const last = selector
    .split(/\s*[\s>+~]\s*/)
    .filter(Boolean)
    .pop()
  if (!last || last.includes('*')) return null
  const tag = /^[a-z][a-z0-9-]*/i.exec(last)?.[0]?.toLowerCase()
  if (tag && tag !== el.tag) return null
  const ids = [...last.matchAll(/#([\w-]+)/g)].map((m) => m[1])
  if (ids.some((id) => id !== el.id)) return null
  const classes = [...last.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) =>
    m[1]!.replace(/\\(.)/g, '$1')
  )
  if (classes.some((c) => !el.classes.has(c))) return null
  if (!tag && !ids.length && !classes.length) return null
  return [ids.length, classes.length, tag ? 1 : 0]
}

/** The declarations that win for an element, by specificity then source order. */
function cascade(rules: Rule[], el: Element): Map<string, string> {
  const hits: Array<{ spec: [number, number, number]; rule: Rule }> = []
  for (const rule of rules)
    for (const selector of rule.selectors) {
      const spec = matches(selector, el)
      if (spec) hits.push({ spec, rule })
    }
  hits.sort(
    (a, b) =>
      a.spec[0] - b.spec[0] ||
      a.spec[1] - b.spec[1] ||
      a.spec[2] - b.spec[2] ||
      a.rule.order - b.rule.order
  )
  const out = new Map<string, string>()
  for (const { spec, rule } of hits)
    for (const [k, v] of rule.decls) {
      // A size set only by a bare tag in em is a reset's default (h1 { font-size: 2em }),
      // not the brand's: it says nothing about the headline the page shows.
      if (k === 'font-size' && spec[0] === 0 && spec[1] === 0 && /^[\d.]+em$/.test(v.trim())) {
        out.delete(k)
        continue
      }
      out.set(k, v)
    }
  return out
}

/** The page's custom properties, from its root rules. */
/**
 * The page's custom properties: its root rules', then those of the theme
 * classes it puts on <html> or <body>, which many sites keep their brand
 * colours under.
 */
function customProperties(rules: Rule[], html: string): Map<string, string> {
  const themes = new Set(
    [...html.matchAll(/<(?:html|body)\b[^>]*\bclass\s*=\s*["']([^"']*)["']/gi)].flatMap((m) =>
      m[1]!.split(/\s+/).filter(Boolean)
    )
  )
  const theme = (selector: string) => {
    const m = /^(?:html|body|:root)?((?:\.[\w-]+)+)$/i.exec(selector)
    return (
      !!m &&
      m[1]!
        .split('.')
        .filter(Boolean)
        .every((name) => themes.has(name))
    )
  }
  const props = new Map<string, string>()
  for (const scoped of [false, true])
    for (const rule of rules)
      if (rule.selectors.some((s) => (scoped ? theme(s) : /^(:root|html|body)$/i.test(s))))
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
  const unit = /^(-?[\d.]+)(px|rem|em|vw|%)?$/i.exec(value)
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

/** The opening tags in a page, as elements. */
function elements(html: string): Array<Element & { attrs: string }> {
  const out: Array<Element & { attrs: string }> = []
  const body = html.replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, '')
  for (const m of body.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs = m[2] ?? ''
    out.push({
      tag: m[1]!.toLowerCase(),
      id: /\bid\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] ?? null,
      classes: new Set(
        (/\bclass\s*=\s*["']([^"']*)/i.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean)
      ),
      attrs,
    })
    if (out.length > 4000) break
  }
  return out
}

/** An element the page keeps out of sight: hidden, for screen readers only, or a notice over it. */
const isHidden = (el: Element & { attrs: string }) =>
  /(^|\s)hidden(\s|=|$)|aria-hidden\s*=\s*["']true/i.test(el.attrs) ||
  [...el.classes].some((c) =>
    /(sr-only|visually-hidden|screen-reader|cookie|consent|modal|dialog)/i.test(c)
  )

/** What a page asks its visitors to do first: the words of a main call to action. */
const CALL_TO_ACTION =
  /^(get( \w+)?( started| free| the app| a demo| \w+ free)?|start\b|sign ?up|try\b|join\b|buy\b|shop\b|book\b|send\b|download\b|request\b|contact sales|create\b|open (an )?account|subscribe\b|learn more)/i
/** Consent and cookie notices, whose buttons are not the brand's. */
const NOTICE =
  /(accept|reject|decline|cookie|consent|preferences|customi[sz]e|agree|allow all|got it)/i
/** Signing in is offered beside the call to action, seldom as it. */
const SIGN_IN = /^(log ?in|sign ?in|my account)$/i

interface Candidate extends Element {
  text: string
  /** How far into the page it sits, 0 at the top. */
  at: number
  buttonish: boolean
}

/** The page's links and buttons with their words and place, notices left out. */
function candidates(html: string): Candidate[] {
  const body = html.replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, '')
  const out: Candidate[] = []
  for (const m of body.matchAll(/<(a|button)\b([^>]*)>([\s\S]{0,400}?)<\/\1>/gi)) {
    const attrs = m[2] ?? ''
    const text = (m[3] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || text.length > 40 || NOTICE.test(text)) continue
    const classes = new Set(
      (/\bclass\s*=\s*["']([^"']*)/i.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean)
    )
    if ([...classes].some((c) => /(cookie|consent|notice|banner-close)/i.test(c))) continue
    const el = {
      tag: m[1]!.toLowerCase(),
      id: /\bid\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] ?? null,
      classes,
      attrs,
    }
    out.push({
      ...el,
      text,
      at: (m.index ?? 0) / Math.max(1, body.length),
      buttonish: isButtonish(el),
    })
    if (out.length > 300) break
  }
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

const isButtonish = (el: Element & { attrs: string }) =>
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
  const props = customProperties(rules, html)
  // A shorthand sets its longhands where its own rule does not, so the cascade weighs them by rule.
  for (const rule of rules) rule.decls = expandFont(rule.decls, props)
  const els = elements(html).filter((el) => !isHidden(el))
  const styleOf = (el: Element | undefined) => (el ? cascade(rules, el) : null)
  const first = (pick: (el: Element & { attrs: string }) => boolean) => els.find(pick)
  // Of the page's headlines, the largest: a site may mark a small label up as an h1 too.
  const largest = (tag: string) =>
    els
      .filter((el) => el.tag === tag)
      .slice(0, 12)
      .map((el) => cascade(rules, el))
      .map((decls) => ({ decls, size: typeOf(decls, props)?.size ?? 0 }))
      .sort((a, b) => b.size - a.size)[0]
  const h1 = largest('h1')?.decls ?? null
  const h2 = styleOf(first((el) => el.tag === 'h2' && !!typeOf(cascade(rules, el), props)))
  // The main button is the call to action the page leads with: its words, its
  // place near the top and its styling, among those whose fill can be read. A
  // known button colour from the site's CSS breaks a tie.
  const filled = (el: Element) => boxOf(cascade(rules, el), props)?.fill
  // A call to action in words near the top is evidence enough to lead with.
  const ranked = candidates(html)
    .map((c) => ({ c, fill: filled(c), score: intent(c) }))
    .filter((x) => !!x.fill && x.score >= 4)
    .sort(
      (a, b) => b.score - a.score || Number(b.fill === brandButton) - Number(a.fill === brandButton)
    )
  const buttons = els.filter(isButtonish).slice(0, 20)
  const button = styleOf(
    ranked[0]?.c ??
      (brandButton && buttons.find((el) => filled(el) === brandButton)) ??
      buttons.find((el) => !!filled(el)) ??
      buttons[0]
  )
  const action = !!ranked[0]
  const card = styleOf(first((el) => [...el.classes].some((c) => /(^|[-_])card([-_]|$)/i.test(c))))
  const field = styleOf(
    first(
      (el) => el.tag === 'input' && !/type\s*=\s*["'](hidden|checkbox|radio|submit)/i.test(el.attrs)
    )
  )
  return {
    headline: h1 && typeOf(h1, props),
    heading: h2 && typeOf(h2, props),
    button:
      button &&
      (() => {
        const box = boxOf(button, props)
        return box && action ? { ...box, action: true } : box
      })(),
    card: card && boxOf(card, props),
    field: field && boxOf(field, props),
  }
}
