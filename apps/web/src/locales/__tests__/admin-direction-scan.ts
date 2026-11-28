/**
 * Finds what keeps admin from mirroring in a right-to-left language:
 *
 * - left/right classes (`ml-2`, `pr-3`, `left-0`, `text-right`, `rounded-l-md`,
 *   `border-r`), which stay on their side, where the logical class
 *   (`ms-2`, `pe-3`, `start-0`, `text-end`, `rounded-s-md`, `border-e`)
 *   follows the reading direction;
 * - icons that point back or next (`ChevronRightIcon`, `ArrowLeftIcon`)
 *   without `rtl:-scale-x-100`, which keeps them pointing the old way, and
 *   such an icon passed by reference (`icon={ArrowLeft}`), which the scan
 *   cannot see mirrored: pass a component that renders it with the mirror;
 * - a chevron or arrow turned a quarter (`-rotate-90`) without an `rtl:`
 *   turn beside it, which points the same physical way in both directions;
 * - a sideways move (`translate-x-4`) without an `rtl:` move in the same
 *   class string, which goes the wrong way once the start is on the right.
 *
 * A side that is physical on purpose (a centred popover's `left-1/2`, a
 * sheet that slides in from the left) stays in the baseline.
 */
import { parseSource, walk, type Finding, type Node } from './admin-ratchet'

/** Utilities with a left/right form and their logical form. */
const LOGICAL: Record<string, string> = {
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
  left: 'start',
  right: 'end',
  'scroll-ml': 'scroll-ms',
  'scroll-mr': 'scroll-me',
  'scroll-pl': 'scroll-ps',
  'scroll-pr': 'scroll-pe',
  'border-l': 'border-s',
  'border-r': 'border-e',
  'rounded-l': 'rounded-s',
  'rounded-r': 'rounded-e',
  'rounded-tl': 'rounded-ss',
  'rounded-tr': 'rounded-se',
  'rounded-bl': 'rounded-es',
  'rounded-br': 'rounded-ee',
  'text-left': 'text-start',
  'text-right': 'text-end',
  'float-left': 'float-start',
  'float-right': 'float-end',
  'clear-left': 'clear-start',
  'clear-right': 'clear-end',
}

/** Utilities that take no value. */
const BARE = new Set([
  'text-left',
  'text-right',
  'float-left',
  'float-right',
  'clear-left',
  'clear-right',
])
/** Utilities whose value is optional (`border-l`, `rounded-l`). */
const OPTIONAL_VALUE = /^(border|rounded)-/
/** A spacing or inset value: a number, a fraction, px/auto/full, or an arbitrary value. */
const LENGTH = /^(\d+(\.\d+)?|\d+\/\d+|px|auto|full|\[[^\]]+\]|\([^)]+\))$/
/** A border or rounding value: a width, a size, a colour or an arbitrary value. */
const OTHER_VALUE = /^([a-z0-9]+(-[a-z0-9]+)*(\/\d+)?|\[[^\]]+\]|\([^)]+\))$/

const UTILITY = new RegExp(
  `^(-?)(${Object.keys(LOGICAL)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?:-(.+))?$`
)

/** A class split into its variants (`md:hover:`), its utility and any `!`. */
function splitClass(token: string): { variants: string; utility: string } {
  let depth = 0
  let cut = -1
  for (let i = 0; i < token.length; i++) {
    const char = token[i]
    if (char === '[' || char === '(') depth++
    else if (char === ']' || char === ')') depth--
    else if (char === ':' && depth === 0) cut = i
  }
  return { variants: token.slice(0, cut + 1), utility: token.slice(cut + 1) }
}

/** The logical form of a left/right class, or null when the class is not one. */
export function logicalClass(token: string): string | null {
  const { variants, utility: raw } = splitClass(token)
  const important = raw.startsWith('!') ? '!' : ''
  const trailing = raw.endsWith('!') ? '!' : ''
  const utility = raw.slice(important.length, raw.length - trailing.length)
  const match = UTILITY.exec(utility)
  if (!match) return null
  const [, negative, name, value] = match
  if (BARE.has(name!)) {
    if (value !== undefined || negative) return null
  } else if (value === undefined) {
    if (!OPTIONAL_VALUE.test(name!)) return null
  } else if (!(OPTIONAL_VALUE.test(name!) ? OTHER_VALUE : LENGTH).test(value)) {
    return null
  }
  const logical = `${negative}${LOGICAL[name!]}${value === undefined ? '' : `-${value}`}`
  return `${variants}${important}${logical}${trailing}`
}

/** Icons that point back or next, so they turn round in a right-to-left page. */
export const DIRECTION_ICON = /^(Chevron(Double)?(Left|Right)|Arrow(Long)?(Left|Right))(Icon)?$/

/** The mirror a direction icon carries in a right-to-left page. */
export const MIRROR = 'rtl:-scale-x-100'

/** Classes that turn an icon round in a right-to-left page: the mirror, or a half turn. */
const TURNS_IN_RTL = new Set([MIRROR, 'rtl:rotate-180'])

/** Chevrons and arrows of any direction: a quarter turn makes them point sideways. */
const TURNABLE_ICON = /^(Chevron|Arrow)[A-Za-z]*$/

/** A quarter turn without variants. */
const QUARTER_TURN = /^-?rotate-90$/

/** A sideways move that is not none (`0`) or a centring half (`1/2`). */
const SIDEWAYS = /^-?translate-x-(?!0$|1\/2$|\[-?50%\]$)/

/** The classes of a string or template text, with the offset each starts at. */
export function classTokens(text: string): { token: string; at: number }[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({ token: match[0], at: match.index! }))
}

function jsxName(node: Node): string {
  if (node.type === 'JSXIdentifier') return node.name as string
  if (node.type === 'JSXMemberExpression') return jsxName(node.property as Node)
  return ''
}

/** Every string and template text inside `node`. */
function textsIn(node: Node | null | undefined): string[] {
  const texts: string[] = []
  walk(node, (inner) => {
    if (inner.type === 'StringLiteral') texts.push(inner.value as string)
    else if (inner.type === 'TemplateElement') {
      texts.push((inner.value as { raw: string }).raw)
    }
  })
  return texts
}

/** Every class in an element's className. */
function classesOf(element: Node): string[] {
  const className = (element.attributes as Node[]).find(
    (attribute) =>
      attribute.type === 'JSXAttribute' && jsxName(attribute.name as Node) === 'className'
  )
  return textsIn(className?.value as Node).flatMap((text) =>
    classTokens(text).map(({ token }) => token)
  )
}

function mirrored(classes: string[]): boolean {
  return classes.some((token) => TURNS_IN_RTL.has(token))
}

/** A quarter turn with no `rtl:` turn beside it. */
function turnedOneWay(classes: string[]): boolean {
  const turned = classes.some((token) => QUARTER_TURN.test(splitClass(token).utility))
  const turnsBack = classes.some((token) => /(^|:)rtl:(.*:)?-?rotate-/.test(token))
  return turned && !turnsBack
}

/** Sideways moves in one class string that have no `rtl:` move beside them. */
function oneWayMoves(text: string): string[] {
  const tokens = classTokens(text).map(({ token }) => token)
  if (tokens.some((token) => /(^|:)rtl:(.*:)?-?translate-x-/.test(token))) return []
  return tokens.filter((token) => {
    const { variants, utility } = splitClass(token)
    return !variants.includes('ltr:') && SIDEWAYS.test(utility.replace(/^!|!$/g, ''))
  })
}

/** Whether an identifier is a value, not an import, a key or a member name. */
function isValue(node: Node, parent: Node | null): boolean {
  if (!parent) return true
  if (parent.type.startsWith('Import') || parent.type.startsWith('Export')) return false
  if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === node) {
    return !!parent.computed
  }
  if (parent.type === 'MemberExpression' && parent.property === node) return !!parent.computed
  return !parent.type.startsWith('TS')
}

export function scanDirection(source: string, file: string): Finding[] {
  const program = parseSource(source, file)
  if (!program) return []
  const findings: Finding[] = []
  walk(program, (node, parent) => {
    const line = node.loc?.start.line ?? 0
    if (node.type === 'StringLiteral' || node.type === 'TemplateElement') {
      const text =
        node.type === 'StringLiteral' ? (node.value as string) : (node.value as { raw: string }).raw
      for (const { token } of classTokens(text)) {
        const logical = logicalClass(token)
        if (logical) findings.push({ line, text: `${token} use ${logical}` })
      }
      for (const token of oneWayMoves(text)) {
        findings.push({ line, text: `${token} add an rtl: move the other way` })
      }
      return
    }
    if (node.type === 'Identifier' && DIRECTION_ICON.test(node.name as string)) {
      if (isValue(node, parent)) {
        findings.push({
          line,
          text: `${node.name as string} passed by reference: pass a component that renders it with ${MIRROR}`,
        })
      }
      return
    }
    if (node.type === 'JSXOpeningElement') {
      const name = jsxName(node.name as Node)
      const classes = classesOf(node)
      if (DIRECTION_ICON.test(name) && !mirrored(classes)) {
        findings.push({ line, text: `<${name}> add ${MIRROR}` })
      }
      if (TURNABLE_ICON.test(name) && turnedOneWay(classes)) {
        findings.push({ line, text: `<${name}> add an rtl: turn the other way` })
      }
    }
  })
  return findings
}
