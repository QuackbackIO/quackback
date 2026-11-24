/**
 * The page's own colours and shapes, read from its stylesheets without
 * running anything: the page background and text colour (body over html and
 * :root), and the main button's fill, corner radius and height, and a card's
 * corner radius.
 *
 * A focused cascade: only rules whose selector is one element on its own (a
 * tag, its classes, attributes, or all of these, utility classes with escapes
 * included) are applied to the few elements read, by specificity and then
 * source order. Custom properties inherit down the page (root, body, the
 * element) as a browser's do. Dark-scheme, small-screen and print media are
 * left out, as a desktop visitor sees the page. The main button is the most
 * prominent of the page's buttons. What cannot be read is left null rather
 * than guessed. Pure; never throws.
 */
import * as csstree from 'css-tree/dist/csstree.esm'
import type { CssNode } from 'css-tree'
import { extractAttr } from '@/lib/server/content/og-parse'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { luminance } from '@/lib/shared/theme/colour-setters'
import { parseOklch } from '@/lib/shared/theme/expand'
import { CONSENT_MARKUP } from './consent'
import { headerFinder, inlineDeclarations, isVoidTag } from './site-header'
import { colourHex, firstColour, resolveVars, splitTopLevel, type Context } from './site-css'

const MAX_CSS_CHARS = 1_500_000
const MAX_SCAN_CHARS = 1_000_000
const ROOT_PX = 16
const MAX_BUTTONS = 40
const MAX_CARDS = 10

export interface PageElement {
  tag: string
  classes: string[]
  attrs: Record<string, string>
}

export interface PageElements {
  html: PageElement
  body: PageElement
  /** The page's buttons in document order, by what its markup names them. */
  buttons: PageElement[]
  cards: PageElement[]
  /**
   * The site's header bar, outermost first, then the first few elements
   * inside it: a bar is often painted on an inner wrapper. Empty when the
   * page has no header before its main content.
   */
  header: PageElement[]
  /** The markup says the page is dark (a dark theme attribute, class or color-scheme). */
  dark: boolean
}

export interface PageStyle {
  /** #rrggbb, `transparent` when the page leaves it to the browser, null when unread. */
  background: string | null
  text: string | null
  button: { fill?: string; radiusPx?: number; radiusPercent?: number; heightPx?: number } | null
  cardRadiusPx: number | null
  /** The header bar's fill (#rrggbb) when its stylesheet paints one, else null. */
  header: string | null
}

const classesOf = (tag: string) => (extractAttr(tag, 'class') ?? '').split(/\s+/).filter(Boolean)

function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(tag.replace(/^<[\w-]+/, ''))) !== null)
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  return attrs
}

const element = (name: string, tag: string | undefined): PageElement =>
  tag
    ? { tag: name, classes: classesOf(tag), attrs: attrsOf(tag) }
    : { tag: name, classes: [], attrs: {} }

const BUTTON_CLASS = /btn|button|(^|[-_])cta([-_A-Z]|$)/i
const CARD_CLASS = /(^|[-_])card([-_]|$)/i
/** A utility-styled link: filled and rounded. */
const isUtilityButton = (classes: string[]) =>
  classes.some((c) => /^bg-/.test(c)) && classes.some((c) => /^rounded/.test(c))

const DARK_ATTRS = ['data-theme', 'data-color-mode', 'data-mode', 'data-color-scheme']
const isDark = (el: PageElement) =>
  el.classes.includes('dark') ||
  DARK_ATTRS.some((name) => el.attrs[name]?.toLowerCase() === 'dark') ||
  /color-scheme\s*:\s*dark/i.test(el.attrs.style ?? '')

/** The elements whose styles are read, from the page's markup. */
export function pageElements(html: string): PageElements {
  const page = html.slice(0, MAX_SCAN_CHARS)
  const first = (name: string) => new RegExp(`<${name}\\b[^>]*>`, 'i').exec(page)?.[0]
  const htmlEl = element('html', first('html'))
  const bodyEl = element('body', first('body'))
  const bodyStart = page.search(/<body\b/i)
  const body = bodyStart === -1 ? page : page.slice(bodyStart)

  const buttons: PageElement[] = []
  const plainButtons: PageElement[] = []
  const cards: PageElement[] = []
  const header = headerFinder()
  // Everything inside a consent banner is the banner's, never the brand's.
  let consent: { name: string; depth: number } | null = null
  const re = /<(\/?)([a-z][\w-]*)\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    const [tag, closing, rawName] = match
    const name = rawName.toLowerCase()
    const selfClosing = tag.endsWith('/>')
    const voidTag = isVoidTag(name, tag)
    header.track({ closing: Boolean(closing), void: voidTag })
    if (buttons.length >= MAX_BUTTONS && cards.length >= MAX_CARDS && !header.busy) break
    if (consent) {
      if (name === consent.name && !selfClosing) consent.depth += closing ? -1 : 1
      if (consent.depth === 0) consent = null
      continue
    }
    if (closing) continue
    if (CONSENT_MARKUP.test(tag)) {
      if (!selfClosing) consent = { name, depth: 1 }
      continue
    }
    const classes = classesOf(tag)
    header.visit({
      name,
      closing: false,
      void: voidTag,
      classes,
      id: extractAttr(tag, 'id') ?? '',
      role: (extractAttr(tag, 'role') ?? '').toLowerCase(),
      element: () => element(name, tag),
    })
    if ((name === 'a' || name === 'button') && buttons.length < MAX_BUTTONS) {
      if (classes.some((c) => BUTTON_CLASS.test(c)) || isUtilityButton(classes))
        buttons.push(element(name, tag))
      else if (name === 'button' && plainButtons.length < MAX_BUTTONS)
        plainButtons.push(element(name, tag))
    }
    if (cards.length < MAX_CARDS && classes.some((c) => CARD_CLASS.test(c)))
      cards.push(element(name, tag))
  }
  return {
    html: htmlEl,
    body: bodyEl,
    buttons: buttons.length ? buttons : plainButtons,
    cards,
    header: header.result(),
    dark: isDark(htmlEl) || isDark(bodyEl),
  }
}

interface Selector {
  tag?: string
  classes: string[]
  attrs: Array<{ name: string; value?: string }>
}

interface Rule {
  selectors: Selector[]
  decls: Array<[property: string, value: string]>
  order: number
}

const textOf = (node: CssNode | null | undefined): string =>
  !node ? '' : node.type === 'Raw' ? node.value : csstree.generate(node)

/** Media a desktop visitor in light mode does not see. */
const UNSEEN_MEDIA = /prefers-color-scheme\s*:\s*dark|\bprint\b|max-width/i

function parseRules(sheets: string[], ctx: Context): Rule[] {
  const rules: Rule[] = []
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
      visit: 'Rule',
      enter(node) {
        if (this.atrule && !/^(media|supports|layer)$/i.test(this.atrule.name)) return
        if (this.atrule && UNSEEN_MEDIA.test(textOf(this.atrule.prelude))) return
        if (!node.block) return
        const texts = splitTopLevel(textOf(node.prelude))
          .map((s) => s.trim())
          .filter(Boolean)
        const rootish = texts.some((s) => /^(:root|html|body)$/i.test(s))
        const decls: Rule['decls'] = []
        node.block.children.forEach((child) => {
          if (child.type !== 'Declaration') return
          const value = textOf(child.value).trim()
          const property = child.property.startsWith('--')
            ? child.property
            : child.property.toLowerCase()
          if (property.startsWith('--'))
            (rootish ? ctx.rootVars : ctx.otherVars).set(property, value)
          decls.push([property, value])
        })
        const selectors = texts.map(parseSelector).filter((sel): sel is Selector => sel !== null)
        if (decls.length && selectors.length) rules.push({ selectors, decls, order: rules.length })
      },
    })
  }
  return rules
}

const SIMPLE =
  /^([a-z][a-z0-9-]*|:root)?((?:\.(?:\\.|[\w-])+|\[[\w:-]+(?:[~]?=\s*(?:"[^"]*"|'[^']*'|[^\]\s"']+))?\])*)$/i

/** One element on its own (a tag, classes, attributes), or null for anything else. */
function parseSelector(text: string): Selector | null {
  const match = SIMPLE.exec(text)
  if (!match || (!match[1] && !match[2])) return null
  const parts = match[2] ?? ''
  const classes = [...parts.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) =>
    m[1].replace(/\\(.)/g, '$1')
  )
  const attrs = [
    ...parts.matchAll(/\[([\w:-]+)(?:[~]?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/g),
  ].map((m) => ({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] }))
  return { tag: match[1]?.toLowerCase(), classes, attrs }
}

/** The specificity of `selector` for `element`, or null when it does not select it. */
function specificity(selector: Selector, el: PageElement & { root?: boolean }): number | null {
  const { tag } = selector
  if (tag === ':root' ? !el.root : tag && tag !== el.tag) return null
  if (!selector.classes.every((c) => el.classes.includes(c))) return null
  for (const attr of selector.attrs) {
    const value = attr.name === 'class' ? el.classes.join(' ') : el.attrs[attr.name]
    if (value === undefined) return null
    if (
      attr.value !== undefined &&
      value !== attr.value &&
      !value.split(/\s+/).includes(attr.value)
    )
      return null
  }
  return (
    (selector.classes.length + selector.attrs.length) * 10 + (tag ? (tag === ':root' ? 10 : 1) : 0)
  )
}

/** The element's declarations as the cascade leaves them: the winning value per property. */
function computed(rules: Rule[], element: PageElement & { root?: boolean }): Map<string, string> {
  const hits: Array<{ spec: number; order: number; decls: Rule['decls'] }> = []
  for (const rule of rules) {
    const specs = rule.selectors
      .map((s) => specificity(s, element))
      .filter((n): n is number => n !== null)
    if (specs.length) hits.push({ spec: Math.max(...specs), order: rule.order, decls: rule.decls })
  }
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order)
  const out = new Map<string, string>()
  for (const hit of hits) for (const [property, value] of hit.decls) out.set(property, value)
  return out
}

const TRANSPARENT = /^(transparent|none|initial|unset)$|rgba?\([^)]*[,/\s]\s*0(\.0+)?%?\s*\)$/i

function backgroundOf(decls: Map<string, string>, ctx: Context): string | null {
  const raw = decls.get('background-color') ?? decls.get('background')
  if (raw === undefined) return null
  const value = resolveVars(raw, ctx)?.trim()
  if (!value) return null
  if (TRANSPARENT.test(value)) return 'transparent'
  return firstColour(value) ?? colourHex(value)
}

/** The fill an element's own markup gives it (style or bgcolor), which wins over its stylesheet. */
const inlineFillOf = (el: PageElement, ctx: Context) => backgroundOf(inlineDeclarations(el), ctx)

function colourOf(decls: Map<string, string>, property: string, ctx: Context): string | null {
  const raw = decls.get(property)
  const value = raw === undefined ? null : resolveVars(raw, ctx)
  return value ? colourHex(value) : null
}

/** A length in px (rem and em at 16px), a percentage, or null. */
function lengthOf(
  raw: string | undefined,
  ctx: Context
): { px: number } | { percent: number } | null {
  if (raw === undefined) return null
  const first = resolveVars(raw, ctx)?.trim().split(/\s+/)[0]
  const match = first && /^(-?[\d.]+)(px|r?em|%)?$/i.exec(first)
  if (!match) return null
  const n = parseFloat(match[1])
  const unit = (match[2] ?? 'px').toLowerCase()
  if (unit === '%') return { percent: n }
  return { px: unit === 'px' ? n : n * ROOT_PX }
}

function radiusOf(decls: Map<string, string>, ctx: Context) {
  return lengthOf(decls.get('border-radius') ?? decls.get('border-top-left-radius'), ctx)
}

/** The custom properties `decls` sets, over those it inherits. */
function inherit(parent: Context, decls: Map<string, string>): Context {
  const rootVars = new Map(parent.rootVars)
  for (const [property, value] of decls)
    if (property.startsWith('--')) rootVars.set(property, value)
  return { rootVars, otherVars: parent.otherVars }
}

type ButtonStyle = NonNullable<PageStyle['button']>

function buttonStyle(decls: Map<string, string>, ctx: Context): ButtonStyle | null {
  const fill = backgroundOf(decls, ctx)
  const radius = radiusOf(decls, ctx)
  const height = lengthOf(decls.get('height') ?? decls.get('min-height'), ctx)
  const read: ButtonStyle = {
    ...(fill && fill !== 'transparent' ? { fill } : {}),
    ...(radius && 'px' in radius ? { radiusPx: radius.px } : {}),
    ...(radius && 'percent' in radius ? { radiusPercent: radius.percent } : {}),
    ...(height && 'px' in height ? { heightPx: height.px } : {}),
  }
  return Object.keys(read).length ? read : null
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Whether a fill draws the eye on this page: a saturated colour (not a pale
 * tint), or a neutral one that stands well apart from the page (black on
 * white, light on dark). A grey, a near-page tint or a pale wash reads as a
 * secondary, hover or disabled button.
 */
export function isProminentFill(fill: string, page: string): boolean {
  const lch = parseOklch(hexToOklch(fill))
  if (!lch) return false
  const pale = lch.l > 0.85 && lch.c < 0.1
  if (lch.c >= 0.05 && !pale) return contrast(fill, page) >= 1.1
  return contrast(fill, page) >= 3
}

/** How much a button reads as the page's main call to action. */
function prominence(el: PageElement, style: ButtonStyle, page: string): number {
  let score = 0
  if (style.fill && isProminentFill(style.fill, page)) score += 4
  if (/primary|cta/i.test(`${el.classes.join(' ')} ${Object.values(el.attrs).join(' ')}`))
    score += 2
  if (style.radiusPx !== undefined || style.radiusPercent !== undefined) score += 1
  return score
}

/** The page's colours and its main button's and card's shapes, from its stylesheets. */
export function readPageStyle(
  sheets: string[],
  elements: PageElements,
  opts: { themeColour?: string | null } = {}
): PageStyle {
  const empty: PageStyle = {
    background: null,
    text: null,
    button: null,
    cardRadiusPx: null,
    header: null,
  }
  try {
    const global: Context = { rootVars: new Map(), otherVars: new Map() }
    const rules = parseRules(sheets, global)
    if (rules.length === 0) {
      // Only the markup's own fills are left to read: a header's style or bgcolor.
      const inline = elements.header
        .map((el) => inlineFillOf(el, global))
        .find((fill) => fill && fill !== 'transparent')
      return { ...empty, header: inline ?? null }
    }

    const root = computed(rules, { ...elements.html, root: true })
    const rootCtx = inherit(global, root)
    const body = computed(rules, elements.body)
    const bodyCtx = inherit(rootCtx, body)
    // The body paints over the root; text inherits from the nearer one.
    let background =
      backgroundOf(body, bodyCtx) ??
      backgroundOf(root, rootCtx) ??
      (body.size || root.size ? 'transparent' : null)
    // A page its markup calls dark whose colours a script sets: its theme colour is its page.
    const theme = opts.themeColour
    if (
      (background === null || background === 'transparent') &&
      elements.dark &&
      theme &&
      luminance(theme) < 0.2
    )
      background = theme
    const text = colourOf(body, 'color', bodyCtx) ?? colourOf(root, 'color', rootCtx)
    const page = background && background !== 'transparent' ? background : '#ffffff'

    let button: PageStyle['button'] = null
    let best = -1
    for (const el of elements.buttons) {
      const decls = computed(rules, el)
      const style = buttonStyle(decls, inherit(bodyCtx, decls))
      if (!style) continue
      const score = prominence(el, style, page)
      if (score > best) {
        best = score
        button = style
      }
    }
    // A fill that does not stand out is a secondary or disabled button's: leave it unread.
    if (button?.fill && !isProminentFill(button.fill, page)) {
      const shape: ButtonStyle = { ...button, fill: undefined }
      delete shape.fill
      button = Object.keys(shape).length ? shape : null
    }

    // A card with square corners is usually a layout wrapper: the first rounded one counts.
    let cardRadiusPx: number | null = null
    for (const el of elements.cards) {
      const decls = computed(rules, el)
      const radius = radiusOf(decls, inherit(bodyCtx, decls))
      if (radius && 'px' in radius && radius.px > 0) {
        cardRadiusPx = radius.px
        break
      }
    }
    // The header's fill: on the header itself, else on the first wrapper inside
    // it that paints one. Each element inherits its custom properties down the chain.
    let header: string | null = null
    let headerCtx = bodyCtx
    for (const el of elements.header) {
      const decls = computed(rules, el)
      headerCtx = inherit(headerCtx, decls)
      const fill = inlineFillOf(el, headerCtx) ?? backgroundOf(decls, headerCtx)
      if (fill && fill !== 'transparent') {
        header = fill
        break
      }
    }
    return { background, text, button, cardRadiusPx, header }
  } catch {
    return empty
  }
}
