/**
 * A strict SVG sanitiser for logos and icons: uploaded wide logos, and those
 * read from other sites.
 *
 * It parses the markup with a small XML tokenizer of its own and rebuilds it
 * from an allowlist: drawing elements and presentation attributes survive,
 * everything else (scripts, styles, foreign content, images, links,
 * animation, event handlers, outside references) is dropped. Before a <style>
 * element is dropped, its simple rules are copied onto the elements they
 * match as presentation attributes (see sheetRules), so a logo coloured by an
 * internal stylesheet keeps its colours. Markup it cannot parse confidently
 * (entity declarations, processing instructions, CDATA outside a stylesheet,
 * unbalanced tags, unknown entities) is refused with null rather than
 * guessed at. Pure: no I/O, never throws.
 */

const DEFAULT_MAX_BYTES = 100 * 1024
const MAX_DEPTH = 64

/** Elements kept, by lowercase name, mapped to their canonical spelling. */
const ELEMENTS = new Map(
  [
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'defs',
    'linearGradient',
    'radialGradient',
    'stop',
    'clipPath',
    'mask',
    'use',
    'symbol',
    'title',
    'desc',
    'text',
    'tspan',
  ].map((name) => [name.toLowerCase(), name])
)

/** Elements whose own tag is dropped but whose children are kept. */
const UNWRAPPED = new Set(['a'])

/** Elements whose text content is kept. */
const TEXT_ELEMENTS = new Set(['title', 'desc', 'text', 'tspan'])

/** Attributes kept, by lowercase name, mapped to their canonical spelling. */
const ATTRIBUTES = new Map(
  [
    'viewBox',
    'width',
    'height',
    'preserveAspectRatio',
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-opacity',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'opacity',
    'transform',
    'clip-rule',
    'clip-path',
    'mask',
    'color',
    'display',
    'visibility',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'clipPathUnits',
    'maskUnits',
    'maskContentUnits',
    'offset',
    'stop-color',
    'stop-opacity',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'fx',
    'fy',
    'r',
    'rx',
    'ry',
    'dx',
    'dy',
    'd',
    'points',
    'pathLength',
    'id',
    'href',
    'role',
    'aria-label',
    'aria-hidden',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-anchor',
    'dominant-baseline',
    'letter-spacing',
  ].map((name) => [name.toLowerCase(), name])
)

/** Style declarations a `style` attribute may carry, kept as attributes. */
const STYLE_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'clip-rule',
  'stop-color',
  'stop-opacity',
  'display',
  'visibility',
  'color',
])

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

interface ElementNode {
  name: string
  attrs: Array<[string, string]>
  children: Array<ElementNode | string>
  /** A <style> element's text, CDATA unwrapped; read for its rules, never kept. */
  css?: string
}

/**
 * Properties a stylesheet rule may give an element. Narrower than an inline
 * style: colour and stroke only, and `display` only as `none`.
 */
const SHEET_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'display',
  'stop-color',
  'stop-opacity',
])

/** A selector this sanitiser reads: one class, one id or one element name. */
type SimpleSelector = { kind: 'class' | 'id' | 'element'; name: string }

interface SheetRule {
  selectors: SimpleSelector[]
  declarations: Array<[string, string]>
}

class Refused extends Error {}

function decodeXml(text: string): string {
  return text.replace(/&([^;\s&]*);?/g, (whole, ref: string) => {
    if (!whole.endsWith(';')) throw new Refused('bare ampersand')
    if (ref in XML_ENTITIES) return XML_ENTITIES[ref]
    const numeric = /^#(?:x([\da-f]+)|(\d+))$/i.exec(ref)
    if (!numeric) throw new Refused('unknown entity')
    const code = numeric[1] ? parseInt(numeric[1], 16) : Number(numeric[2])
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) throw new Refused('bad reference')
    return String.fromCodePoint(code)
  })
}

const NAME = /[A-Za-z_][\w:.-]*/y
const SPACE = /\s*/y

/** Parses the markup into a tree rooted at its single <svg>, or throws Refused. */
function parse(markup: string): ElementNode {
  let pos = 0
  const at = (re: RegExp): string | null => {
    re.lastIndex = pos
    const m = re.exec(markup)
    if (!m) return null
    pos = re.lastIndex
    return m[0]
  }
  const skipSpace = () => at(SPACE)

  // The prolog: an XML declaration, comments, and a DOCTYPE without an internal subset.
  for (;;) {
    skipSpace()
    if (markup.startsWith('<?xml', pos) && pos === markup.search(/\S/)) {
      const end = markup.indexOf('?>', pos)
      if (end === -1) throw new Refused('unterminated declaration')
      pos = end + 2
    } else if (markup.startsWith('<!--', pos)) {
      const end = markup.indexOf('-->', pos + 4)
      if (end === -1) throw new Refused('unterminated comment')
      pos = end + 3
    } else if (/^<!doctype/i.test(markup.slice(pos, pos + 9))) {
      const end = markup.indexOf('>', pos)
      const doctype = end === -1 ? '' : markup.slice(pos, end)
      if (end === -1 || doctype.includes('[') || /<!entity/i.test(doctype)) {
        throw new Refused('entity declarations')
      }
      pos = end + 1
    } else break
  }

  const root: ElementNode = { name: '#root', attrs: [], children: [] }
  const stack: ElementNode[] = [root]
  let sawRoot = false

  while (pos < markup.length) {
    const lt = markup.indexOf('<', pos)
    const textEnd = lt === -1 ? markup.length : lt
    if (textEnd > pos) {
      const text = markup.slice(pos, textEnd)
      if (stack.length === 1) {
        if (text.trim()) throw new Refused('text outside the root')
      } else {
        stack[stack.length - 1].children.push(decodeXml(text))
      }
      pos = textEnd
      continue
    }
    if (markup.startsWith('<!--', pos)) {
      const end = markup.indexOf('-->', pos + 4)
      if (end === -1) throw new Refused('unterminated comment')
      pos = end + 3
      continue
    }
    if (markup.startsWith('<!', pos) || markup.startsWith('<?', pos)) {
      throw new Refused('declaration, CDATA or processing instruction')
    }
    if (markup.startsWith('</', pos)) {
      pos += 2
      const name = at(NAME)
      skipSpace()
      if (!name || markup[pos] !== '>') throw new Refused('bad end tag')
      pos += 1
      const lower = name.toLowerCase()
      let open = stack.length - 1
      while (open > 0 && stack[open].name.toLowerCase() !== lower) open--
      if (open === 0) throw new Refused('unmatched end tag')
      // Elements left open inside it close with it, as an HTML parser closes them.
      stack.length = open
      continue
    }
    pos += 1
    const name = at(NAME)
    if (!name) throw new Refused('bad start tag')
    const node: ElementNode = { name, attrs: [], children: [] }
    let selfClosing = false
    for (;;) {
      const spaced = skipSpace()
      if (markup.startsWith('/>', pos)) {
        selfClosing = true
        pos += 2
        break
      }
      if (markup[pos] === '>') {
        pos += 1
        break
      }
      if (!spaced) throw new Refused('attributes run together')
      const attr = at(/[^\s=/>"'<]+/y)
      if (!attr) throw new Refused('bad attribute')
      skipSpace()
      let value = ''
      if (markup[pos] === '=') {
        pos += 1
        skipSpace()
        const quote = markup[pos]
        if (quote === '"' || quote === "'") {
          const end = markup.indexOf(quote, pos + 1)
          if (end === -1) throw new Refused('unterminated attribute')
          value = markup.slice(pos + 1, end)
          pos = end + 1
        } else {
          const bare = at(/[^\s"'=<>`]+/y)
          if (bare === null) throw new Refused('bad attribute value')
          value = bare
          if (value.endsWith('/') && markup[pos] === '>') {
            value = value.slice(0, -1)
            pos -= 1
          }
        }
        if (value.includes('<')) throw new Refused('angle bracket in attribute')
        value = decodeXml(value)
      }
      if (!node.attrs.some(([existing]) => existing.toLowerCase() === attr.toLowerCase())) {
        node.attrs.push([attr, value])
      }
    }
    if (stack.length === 1) {
      if (sawRoot || name.toLowerCase() !== 'svg') throw new Refused('not a single svg root')
      sawRoot = true
    }
    if (stack.length > MAX_DEPTH) throw new Refused('too deep')
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
    if (!selfClosing && name.toLowerCase() === 'style') {
      // Its text is CSS, read as a whole up to its end tag (which the loop
      // then closes as usual). CDATA is allowed here and only here.
      const end = markup.toLowerCase().indexOf('</style', pos)
      if (end === -1) throw new Refused('unterminated style')
      node.css = styleText(markup.slice(pos, end))
      pos = end
    }
  }
  if (stack.length !== 1) throw new Refused('unclosed elements')
  const svg = root.children.find((child): child is ElementNode => typeof child !== 'string')
  if (!svg) throw new Refused('no svg')
  return svg
}

/** A <style> element's text: CDATA sections taken as they are, the rest decoded. */
function styleText(raw: string): string {
  let text = ''
  let rest = raw
  for (;;) {
    const open = rest.indexOf('<![CDATA[')
    if (open === -1) break
    const close = rest.indexOf(']]>', open + 9)
    if (close === -1) throw new Refused('unterminated CDATA')
    text += decodeXml(rest.slice(0, open)) + rest.slice(open + 9, close)
    rest = rest.slice(close + 3)
  }
  text += decodeXml(rest)
  if (text.includes('<')) throw new Refused('markup in a stylesheet')
  return text
}

function parseSelector(text: string): SimpleSelector | null {
  const match = /^([.#]?)(-?[A-Za-z_][\w-]*)$/.exec(text.trim())
  if (!match) return null
  const kind = match[1] === '.' ? 'class' : match[1] === '#' ? 'id' : 'element'
  return { kind, name: kind === 'element' ? match[2].toLowerCase() : match[2] }
}

/**
 * The rules of a stylesheet this sanitiser can apply: simple selectors (one
 * class, id or element name, in comma lists) and allowlisted declarations
 * whose values pass the same checks as attributes. At-rules (with their
 * blocks), other selectors and other properties are skipped.
 */
function sheetRules(css: string): SheetRule[] {
  const text = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ')
  const rules: SheetRule[] = []
  let pos = 0
  while (pos < text.length) {
    const brace = text.indexOf('{', pos)
    const semi = text.indexOf(';', pos)
    const head = text.slice(pos, brace === -1 ? text.length : brace).trim()
    if (head.startsWith('@')) {
      // An at-rule: a statement to its semicolon, or a block to its matching brace.
      if (semi !== -1 && (brace === -1 || semi < brace)) {
        pos = semi + 1
        continue
      }
      if (brace === -1) break
      let depth = 0
      let i = brace
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}' && --depth === 0) break
      }
      pos = i + 1
      continue
    }
    if (brace === -1) break
    const close = text.indexOf('}', brace)
    if (close === -1) break
    const body = text.slice(brace + 1, close)
    pos = close + 1
    if (body.includes('{')) continue
    const selectors = head
      .split(',')
      .map(parseSelector)
      .filter((selector): selector is SimpleSelector => selector !== null)
    if (selectors.length === 0) continue
    const declarations: Array<[string, string]> = []
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      const property = part.slice(0, colon).trim().toLowerCase()
      const value = part.slice(colon + 1).trim()
      if (!SHEET_PROPERTIES.has(property) || !value || /!important/i.test(value)) continue
      if (property === 'display' && value.toLowerCase() !== 'none') continue
      if (!safeValue(value)) continue
      declarations.push([property, value])
    }
    if (declarations.length > 0) rules.push({ selectors, declarations })
  }
  return rules
}

/** Every rule of every <style> in the tree, in document order. */
function collectRules(node: ElementNode, into: SheetRule[] = []): SheetRule[] {
  if (node.css !== undefined) into.push(...sheetRules(node.css))
  for (const child of node.children) if (typeof child !== 'string') collectRules(child, into)
  return into
}

/**
 * What the stylesheet gives this element. Deliberately simpler than CSS
 * specificity: matching rules apply in document order, last wins, whatever
 * their selector; the element's own style attribute then wins over them.
 */
function sheetDeclarations(
  node: ElementNode,
  rules: readonly SheetRule[]
): Array<[string, string]> {
  if (rules.length === 0) return []
  const attr = (name: string) =>
    node.attrs.find(([attrName]) => attrName.toLowerCase() === name)?.[1]
  const classes = new Set((attr('class') ?? '').split(/\s+/).filter(Boolean))
  const id = attr('id')?.trim()
  const element = node.name.toLowerCase()
  const matches = (selector: SimpleSelector) =>
    selector.kind === 'class'
      ? classes.has(selector.name)
      : selector.kind === 'id'
        ? id === selector.name
        : element === selector.name
  return rules.filter((rule) => rule.selectors.some(matches)).flatMap((rule) => rule.declarations)
}

/** Every url() in a value must point inside the document. */
function urlsAreInternal(value: string): boolean {
  const urls = value.match(/url\s*\(([^)]*)\)/gi) ?? []
  if (/url\s*\(/i.test(value) && urls.length === 0) return false
  return urls.every((url) => /^url\s*\(\s*(['"]?)#[\w.:-]+\1\s*\)$/i.test(url))
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
  }
  return false
}

function safeValue(value: string): boolean {
  return (
    urlsAreInternal(value) &&
    !/expression\s*\(|javascript:|@import|\\/i.test(value) &&
    !hasControlCharacters(value)
  )
}

function styleDeclarations(style: string): Array<[string, string]> {
  if (!safeValue(style)) return []
  const declarations: Array<[string, string]> = []
  for (const part of style.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (STYLE_PROPERTIES.has(property) && value && !/!important/i.test(value)) {
      declarations.push([property, value])
    }
  }
  return declarations
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function cleanAttributes(
  node: ElementNode,
  element: string,
  currentColor: string | undefined,
  rules: readonly SheetRule[]
): Array<[string, string]> {
  const kept = new Map<string, string>()
  const fromStyle: Array<[string, string]> = []
  for (const [rawName, rawValue] of node.attrs) {
    const lower = rawName.toLowerCase()
    if (lower === 'style') {
      fromStyle.push(...styleDeclarations(rawValue))
      continue
    }
    const name = lower === 'xlink:href' ? 'href' : ATTRIBUTES.get(lower)
    if (!name || kept.has(name)) continue
    const value = rawValue.trim()
    if (name === 'href') {
      if (element !== 'use' || !/^#[\w.:-]+$/.test(value)) continue
    } else if (!safeValue(value)) continue
    kept.set(name, value)
  }
  // A stylesheet rule outranks the attribute of the same name, and the
  // element's own style outranks both, as in CSS.
  for (const [name, value] of sheetDeclarations(node, rules)) kept.set(name, value)
  for (const [name, value] of fromStyle) kept.set(name, value)
  const attrs = [...kept.entries()]
  return currentColor
    ? attrs.map(([name, value]) => [name, value.replace(/currentcolor/gi, currentColor)])
    : attrs
}

function serialise(
  node: ElementNode,
  currentColor: string | undefined,
  isRoot: boolean,
  rules: readonly SheetRule[]
): { markup: string; drawn: boolean } {
  const lower = node.name.toLowerCase()
  const children = (keepText: boolean) => {
    let markup = ''
    let drawn = false
    for (const child of node.children) {
      if (typeof child === 'string') {
        const text = child.replace(/\s+/g, ' ')
        if (keepText && text.trim()) markup += escapeText(text)
        continue
      }
      const inner = serialise(child, currentColor, false, rules)
      markup += inner.markup
      drawn ||= inner.drawn
    }
    return { markup, drawn }
  }
  if (UNWRAPPED.has(lower)) return children(false)
  const element = ELEMENTS.get(lower)
  if (!element) return { markup: '', drawn: false }

  const attrs = cleanAttributes(node, element, currentColor, rules)
  if (isRoot) {
    const viewBox = attrs.find(([name]) => name === 'viewBox')
    if (!viewBox) {
      const size = (name: string) => {
        const value = attrs.find(([attr]) => attr === name)?.[1]
        const match = value ? /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value) : null
        return match ? Number(match[1]) : null
      }
      const width = size('width')
      const height = size('height')
      if (!width || !height) throw new Refused('no viewBox and no size')
      attrs.unshift(['viewBox', `0 0 ${width} ${height}`])
    }
    attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg'])
  }
  const inner = children(TEXT_ELEMENTS.has(lower))
  const open = `<${element}${attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('')}`
  const markup = inner.markup ? `${open}>${inner.markup}</${element}>` : `${open}/>`
  const drawn =
    inner.drawn ||
    ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'text'].includes(
      lower
    )
  return { markup, drawn }
}

/**
 * The markup, rebuilt from the allowlist, or null when it is too large, cannot
 * be parsed confidently, or draws nothing. `currentColor` replaces the
 * `currentColor` keyword (a header logo drawn in the text colour).
 */
export function sanitizeSvg(
  markup: string,
  opts: { currentColor?: string; maxBytes?: number } = {}
): string | null {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  try {
    if (Buffer.byteLength(markup, 'utf8') > maxBytes) return null
    const currentColor =
      opts.currentColor && /^#[\da-f]{3,8}$/i.test(opts.currentColor)
        ? opts.currentColor
        : undefined
    const root = parse(markup)
    const { markup: clean, drawn } = serialise(root, currentColor, true, collectRules(root))
    if (!drawn || Buffer.byteLength(clean, 'utf8') > maxBytes) return null
    return clean
  } catch {
    return null
  }
}

/** The width and height an SVG's viewBox gives, or null. */
export function svgViewBoxSize(markup: string): { width: number; height: number } | null {
  const match =
    /<svg\b[^>]*\sviewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(
      markup
    )
  if (!match) return null
  const width = Number(match[3])
  const height = Number(match[4])
  return width > 0 && height > 0 ? { width, height } : null
}
