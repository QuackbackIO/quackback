/**
 * What a site's stylesheets say about its brand: the font families its
 * headings and body text use, the families it declares with @font-face, and
 * the colours it names as brand, primary or accent or paints its buttons with.
 *
 * Pure and tolerant: css-tree parses in its forgiving mode, input is capped,
 * and nothing throws. It reads the cascade only roughly: simple selectors
 * (`h1`, `body`, `.title`), custom properties resolved through `var()`, and
 * later rules beating earlier ones at the same level.
 */
import * as csstree from 'css-tree/dist/csstree.esm'
import type { CssNode } from 'css-tree'
import { normaliseColor } from '@/lib/shared/design/color'
import { hexToOklch, oklchToHex } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import { isConsentSelector } from './consent'
import type { ColourCandidate, FontFact } from './types'

const MAX_CSS_CHARS = 1_500_000
const MAX_FACES = 40
const MAX_COLOURS = 12
const MAX_VAR_DEPTH = 8
/** Below this OKLCH chroma a colour reads as white, black or grey rather than a brand. */
const NEUTRAL_CHROMA = 0.04

export interface SiteCss {
  heading: FontFact | null
  body: FontFact | null
  faces: string[]
  colours: ColourCandidate[]
}

export interface SiteCssOptions {
  /** The classes the page's first h1 carries. */
  headingClasses?: string[]
  /** The classes the page's body (and html) element carries. */
  bodyClasses?: string[]
}

type Generic = FontFact['generic']

type Kind = Exclude<Generic, null>

/** Lowercase names, each listed under the kind it stands for. */
const byKind = (lists: Record<Kind, string>): Record<string, Kind> =>
  Object.fromEntries(
    (Object.entries(lists) as Array<[Kind, string]>).flatMap(([kind, names]) =>
      names.split('|').map((name) => [name, kind])
    )
  )

/** Generic family keywords, and the system-interface aliases that act as one. */
const GENERIC_KEYWORDS = byKind({
  serif: 'serif|ui-serif',
  sans: 'sans-serif|ui-sans-serif|system-ui|-apple-system|blinkmacsystemfont|ui-rounded',
  mono: 'monospace|ui-monospace',
})
const OTHER_GENERICS = new Set(
  'cursive|fantasy|emoji|math|fangsong|inherit|initial|unset|revert'.split('|')
)
/** System-interface aliases: a stack that starts with one is the system font. */
const SYSTEM_ALIASES = new Set([
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'ui-sans-serif',
])

/** Fallback families common enough to say which kind a stack falls back to. */
const KNOWN_FALLBACKS = byKind({
  serif: 'georgia|times|times new roman|cambria|garamond|book antiqua|palatino',
  sans: 'helvetica|helvetica neue|arial|segoe ui|verdana|tahoma|roboto|noto sans',
  mono: 'menlo|consolas|monaco|courier|courier new|sf mono|liberation mono',
})

/** Splits on commas outside parentheses and quotes. */
function splitTopLevel(value: string, separator = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

/**
 * A family name as a person would write it: quotes gone, a build tool's
 * prefix and hash suffix gone (`__Inter_d65c78` is Inter,
 * `Brandface-1bbd4a4c7a2fb472` is Brandface), or null for a generated
 * fallback or placeholder family.
 */
export function cleanFamilyName(raw: string): string | null {
  let name = raw
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim()
  const prefixed = /^__(.+?)_[\da-f]{5,}$/i.exec(name)
  if (prefixed) name = prefixed[1].replace(/_/g, ' ')
  const hashed = /^(.+?)[-_]([\da-f]{6,})$/i.exec(name)
  if (hashed && /\d/.test(hashed[2])) name = hashed[1]
  name = name.replace(/\s+/g, ' ').trim()
  if (!name || name.length > 80) return null
  if (/\b(fallback|placeholder)$/i.test(name)) return null
  return name
}

/** A font-family value read as a FontFact, or null when it names nothing. */
export function fontFactOf(value: string, from: string): FontFact | null {
  const stack = splitTopLevel(value)
    .map(cleanFamilyName)
    .filter((name): name is string => name !== null)
  if (stack.length === 0) return null
  const lower = stack.map((name) => name.toLowerCase())
  if (lower.some((name) => name.includes('var('))) return null
  let generic: Generic = null
  for (const name of lower) {
    if (GENERIC_KEYWORDS[name]) {
      generic = GENERIC_KEYWORDS[name]
      break
    }
  }
  if (!generic) {
    for (const name of lower) {
      if (KNOWN_FALLBACKS[name]) {
        generic = KNOWN_FALLBACKS[name]
        break
      }
    }
  }
  const isGeneric = (name: string) => name in GENERIC_KEYWORDS || OTHER_GENERICS.has(name)
  let family: string | undefined
  if (SYSTEM_ALIASES.has(lower[0])) family = 'system-ui'
  else family = stack.find((_, i) => !isGeneric(lower[i]))
  // A stack of generic keywords alone (`serif`) is named by its keyword.
  if (!family) family = stack[0]
  if (OTHER_GENERICS.has(family.toLowerCase())) return null
  return { family, stack, generic, from }
}

/** The family list of a `font` shorthand, after its size (`700 2rem/1.2 "Inter", serif`). */
function shorthandFamilies(value: string): string | null {
  const [first, ...rest] = splitTopLevel(value)
  const tokens = first.trim().match(/"[^"]*"|'[^']*'|[^\s(]*\([^)]*\)\S*|\S+/g) ?? []
  const size = tokens.findLastIndex((token) =>
    /^(?:[\d.]+(?:px|r?em|%|pt|vw|vh|ch|ex)|xx?-small|x?-?small|medium|x?x?-?large|larger|smaller|calc\(.*\)|var\(.*\)|clamp\(.*\)|min\(.*\)|max\(.*\))(?:\/\S+)?$/i.test(
      token
    )
  )
  if (size === -1) return null
  const family = tokens.slice(size + 1).join(' ')
  if (!family) return null
  return [family, ...rest].join(',')
}

interface Context {
  rootVars: Map<string, string>
  otherVars: Map<string, string>
}

/** The value with every var() replaced by its custom property or fallback, or null. */
function resolveVars(value: string, ctx: Context, depth = 0): string | null {
  if (depth > MAX_VAR_DEPTH) return null
  const start = value.search(/var\(/i)
  if (start === -1) return value
  let depthCount = 0
  let end = -1
  for (let i = start + 3; i < value.length; i++) {
    if (value[i] === '(') depthCount++
    else if (value[i] === ')') {
      depthCount--
      if (depthCount === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return null
  const inner = value.slice(start + 4, end)
  const comma = splitTopLevel(inner)
  const name = comma[0].trim()
  const fallback = comma.length > 1 ? comma.slice(1).join(',').trim() : null
  const declared = ctx.rootVars.get(name) ?? ctx.otherVars.get(name)
  let replacement: string | null = null
  if (declared !== undefined) replacement = resolveVars(declared.trim(), ctx, depth + 1)
  if ((replacement === null || replacement === '') && fallback !== null) {
    replacement = resolveVars(fallback, ctx, depth + 1)
  }
  if (replacement === null) return null
  return resolveVars(value.slice(0, start) + replacement + value.slice(end + 1), ctx, depth + 1)
}

const ROOT_SELECTORS = new Set([':root', 'html', 'body'])

function textOf(node: CssNode | null | undefined): string {
  if (!node) return ''
  if (node.type === 'Raw') return node.value
  return csstree.generate(node)
}

interface FontDecl {
  level: number
  order: number
  value: string
  from: string
}

/** Raw shadcn-style HSL channels (`222 47% 11%`), read as hsl(). */
function channelsAsHsl(value: string): string {
  return /^\d+(?:\.\d+)?(?:deg)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/.test(value.trim())
    ? `hsl(${value.trim().replace(/\s+/g, ', ')})`
    : value
}

/** A colour literal as #rrggbb, or null (named colours, translucent colours, anything else). */
export function colourHex(value: string): string | null {
  let colour = channelsAsHsl(value).trim().toLowerCase()
  const fn = /^(rgb|hsl)a?\((.*)\)$/.exec(colour)
  if (fn) {
    let [args, alpha = null] = fn[2].split('/').map((part) => part.trim()) as [string, string?]
    let parts = args.includes(',') ? args.split(',').map((part) => part.trim()) : args.split(/\s+/)
    if (parts.length === 4 && alpha === null) {
      alpha = parts[3]
      parts = parts.slice(0, 3)
    }
    if (parts.length !== 3) return null
    if (alpha !== null) {
      const opacity = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
      if (!(opacity >= 0.95)) return null
    }
    colour = `${fn[1]}(${parts.join(', ')})`
  }
  const normal = normaliseColor(colour)
  if (!normal) return null
  if (normal.startsWith('#')) return normal
  try {
    return oklchToHex(normal).toLowerCase()
  } catch {
    return null
  }
}

/** Whether a #rrggbb colour reads as white, black or grey rather than a brand. */
export function isNeutralColour(hex: string): boolean {
  const oklch = parseOklch(hexToOklch(hex))
  return !oklch || oklch.c < NEUTRAL_CHROMA
}

/** The first colour literal in a background value, after var() resolution. */
function firstColour(value: string): string | null {
  const tokens = value.match(/#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]*\)/gi) ?? []
  for (const token of tokens) {
    const hex = colourHex(token)
    if (hex) return hex
  }
  return null
}

function selectorClasses(selector: string): string | null {
  const match = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(selector.replace(/\\/g, ''))
  return match ? match[1] : null
}

/**
 * The heading and body fonts, @font-face families and brand colour
 * candidates of the given stylesheets, in cascade order.
 */
export function readSiteCss(sheets: string[], opts: SiteCssOptions = {}): SiteCss {
  const empty: SiteCss = { heading: null, body: null, faces: [], colours: [] }
  try {
    const headingClasses = new Set(opts.headingClasses ?? [])
    const bodyClasses = new Set(opts.bodyClasses ?? [])
    const ctx: Context = { rootVars: new Map(), otherVars: new Map() }
    const headingDecls: FontDecl[] = []
    const bodyDecls: FontDecl[] = []
    const faces = new Map<string, string>()
    const colourVars: Array<{ name: string; value: string }> = []
    const buttonBackgrounds: string[] = []
    let hasH1 = false
    let order = 0
    let budget = MAX_CSS_CHARS

    for (const raw of sheets) {
      if (budget <= 0) break
      const css = raw.slice(0, budget)
      budget -= css.length
      let ast: CssNode
      try {
        ast = csstree.parse(css, {
          parseValue: false,
          parseRulePrelude: false,
          parseAtrulePrelude: false,
          parseCustomProperty: false,
          onParseError: () => {},
        })
      } catch {
        continue
      }
      csstree.walk(ast, {
        visit: 'Atrule',
        enter(node) {
          if (node.name.toLowerCase() !== 'font-face' || !node.block) return
          node.block.children.forEach((child) => {
            if (child.type !== 'Declaration' || child.property.toLowerCase() !== 'font-family')
              return
            const name = cleanFamilyName(textOf(child.value))
            if (name && !faces.has(name.toLowerCase()) && faces.size < MAX_FACES) {
              faces.set(name.toLowerCase(), name)
            }
          })
        },
      })
      csstree.walk(ast, {
        visit: 'Rule',
        enter(node) {
          if (
            this.atrule &&
            /^(font-face|keyframes|-webkit-keyframes|page)$/i.test(this.atrule.name)
          ) {
            return
          }
          if (
            this.atrule?.name.toLowerCase() === 'media' &&
            /\bprint\b/i.test(textOf(this.atrule.prelude))
          ) {
            return
          }
          const selectors = splitTopLevel(textOf(node.prelude))
            .map((s) => s.trim().replace(/\s+/g, ' '))
            .filter(Boolean)
          const lowered = selectors.map((s) => s.toLowerCase())
          const rootish = lowered.some((s) => ROOT_SELECTORS.has(s))
          // A consent banner's rules are never the brand's: its selectors count for no colour.
          const brandSelectors = lowered.filter((s) => !isConsentSelector(s))
          const buttonish = brandSelectors.some((s) =>
            /\bbutton\b|\.btn\b|\[type=["']?submit["']?\]|cta/.test(s)
          )
          let heading: { level: number; from: string } | null = null
          let body: { level: number; from: string } | null = null
          const toHeading = (level: number, from: string) => {
            if (!heading || heading.level < level) heading = { level, from }
          }
          const toBody = (level: number, from: string) => {
            if (!body || body.level < level) body = { level, from }
          }
          for (const [i, selector] of selectors.entries()) {
            const lower = lowered[i]
            const cls = selectorClasses(selector)
            if (cls && headingClasses.has(cls)) toHeading(5, selector)
            if (lower === 'h1') toHeading(4, selector)
            if (lower === 'h2') toHeading(3, selector)
            if (cls && bodyClasses.has(cls)) {
              toHeading(2, selector)
              toBody(2, selector)
            }
            if (lower === 'body') {
              toHeading(1, selector)
              toBody(1, selector)
            }
            if (lower === 'html' || lower === ':root') {
              toHeading(0, selector)
              toBody(0, selector)
            }
          }
          const headingTarget = heading as { level: number; from: string } | null
          const bodyTarget = body as { level: number; from: string } | null
          if (!node.block) return
          node.block.children.forEach((child) => {
            if (child.type !== 'Declaration') return
            const property = child.property
            const value = textOf(child.value).trim()
            if (property.startsWith('--')) {
              ;(rootish ? ctx.rootVars : ctx.otherVars).set(property, value)
              if (brandSelectors.length && /brand|primary|accent|cta|highlight/i.test(property)) {
                colourVars.push({ name: property, value })
              }
              return
            }
            const lower = property.toLowerCase()
            if (buttonish && (lower === 'background' || lower === 'background-color')) {
              buttonBackgrounds.push(value)
            }
            if (lower !== 'font-family' && lower !== 'font') return
            const families = lower === 'font' ? shorthandFamilies(value) : value
            if (!families) return
            order++
            if (headingTarget) {
              if (headingTarget.level === 4) hasH1 = true
              headingDecls.push({ ...headingTarget, order, value: families })
            }
            if (bodyTarget) bodyDecls.push({ ...bodyTarget, order, value: families })
          })
        },
      })
    }

    const pick = (decls: FontDecl[]): FontFact | null => {
      const ranked = decls
        .filter((decl) => !(hasH1 && decl.level === 3))
        .sort((a, b) => b.level - a.level || b.order - a.order)
      for (const decl of ranked) {
        const resolved = resolveVars(decl.value, ctx)
        if (!resolved) continue
        const varName = /^\s*var\(\s*(--[\w-]+)/.exec(decl.value)?.[1]
        const fact = fontFactOf(resolved, varName ?? decl.from)
        if (fact) return fact
      }
      return null
    }

    const colours = new Map<string, ColourCandidate & { order: number }>()
    let colourOrder = 0
    const offer = (hex: string | null, from: string, weight: number) => {
      if (!hex) return
      const effective = isNeutralColour(hex) ? 0 : weight
      if (effective === 0) return
      const existing = colours.get(hex)
      colourOrder++
      if (!existing || existing.weight < effective) {
        colours.set(hex, { hex, from, weight: effective, order: existing?.order ?? colourOrder })
      }
    }
    for (const { name, value } of colourVars) {
      const resolved = resolveVars(value, ctx)
      if (!resolved) continue
      offer(colourHex(resolved), name, /brand|primary/i.test(name) ? 3 : 2)
    }
    for (const value of buttonBackgrounds) {
      const resolved = resolveVars(value, ctx)
      if (resolved) offer(firstColour(resolved), 'button background', 2)
    }

    return {
      heading: pick(headingDecls),
      body: pick(bodyDecls),
      faces: [...faces.values()],
      colours: [...colours.values()]
        .sort((a, b) => b.weight - a.weight || a.order - b.order)
        .slice(0, MAX_COLOURS)
        .map(({ hex, from, weight }) => ({ hex, from, weight })),
    }
  } catch {
    return empty
  }
}
