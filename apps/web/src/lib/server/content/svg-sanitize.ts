/**
 * A strict SVG sanitiser for logos and icons read from other sites.
 *
 * It parses the markup with a small XML tokenizer of its own and rebuilds it
 * from an allowlist: drawing elements and presentation attributes survive,
 * everything else (scripts, styles, foreign content, images, links,
 * animation, event handlers, outside references) is dropped. Markup it cannot
 * parse confidently (entity declarations, processing instructions, CDATA,
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
  }
  if (stack.length !== 1) throw new Refused('unclosed elements')
  const svg = root.children.find((child): child is ElementNode => typeof child !== 'string')
  if (!svg) throw new Refused('no svg')
  return svg
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
  currentColor: string | undefined
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
  // A style declaration outranks the attribute of the same name, as in CSS.
  for (const [name, value] of fromStyle) kept.set(name, value)
  const attrs = [...kept.entries()]
  return currentColor
    ? attrs.map(([name, value]) => [name, value.replace(/currentcolor/gi, currentColor)])
    : attrs
}

function serialise(
  node: ElementNode,
  currentColor: string | undefined,
  isRoot: boolean
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
      const inner = serialise(child, currentColor, false)
      markup += inner.markup
      drawn ||= inner.drawn
    }
    return { markup, drawn }
  }
  if (UNWRAPPED.has(lower)) return children(false)
  const element = ELEMENTS.get(lower)
  if (!element) return { markup: '', drawn: false }

  const attrs = cleanAttributes(node, element, currentColor)
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
    const { markup: clean, drawn } = serialise(root, currentColor, true)
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
