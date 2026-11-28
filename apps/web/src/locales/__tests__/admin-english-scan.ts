/**
 * Finds English written in admin code rather than in the catalog: text
 * between tags, the props people read (labels, placeholders, titles,
 * descriptions, aria-labels and the like), the same fields on plain objects,
 * and toast messages, including each text a choice or a fallback can show
 * (`busy ? 'Saving…' : 'Save'`, `name ?? 'Unnamed'`). A message's English beside its id (`defaultMessage`,
 * `<FormattedMessage>`) is the catalog's own and is not counted.
 */
import { parseSource, walk, type Finding, type Node } from './admin-ratchet'

/** Props and object fields whose text a person reads. */
export const READ_PROPS = new Set([
  'label',
  'placeholder',
  'title',
  'description',
  'aria-label',
  'alt',
  'tooltip',
  'emptyText',
  'helperText',
  'hint',
  'confirmLabel',
  'cancelLabel',
  'heading',
  'subtitle',
  'emptyMessage',
  'actionLabel',
])

/** Calls whose first argument a person reads: toasts and the browser's own dialogs. */
const READ_CALLS = /^(toast(\.(success|error|info|warning|message|loading))?|alert|confirm)$/

/** A message key or a path: lowercase parts joined by dots, colons or slashes. */
const KEY_OR_PATH = /^[a-z0-9_-]+([.:/#][a-z0-9_-]+)+$/

/**
 * Whether a text reads as words, not a key, a path, a class or a URL. Text
 * between tags and in a read prop is shown as it is, so a single lowercase
 * word there counts (`loose`); in other places a lone lowercase token is
 * usually a value.
 */
export function hasWords(text: string, loose = false): boolean {
  const trimmed = text.trim()
  if (!/[A-Za-z]{2,}/.test(trimmed)) return false
  if (loose ? KEY_OR_PATH.test(trimmed) : /^[a-z0-9_\-./:#@{}$]+$/.test(trimmed)) return false
  return !/^(https?:|\/|#|var\(|[a-z-]+:)/.test(trimmed)
}

/** Where a value goes into a template's text. */
const VALUE = '{…}'

function literal(node: Node | null | undefined): string | null {
  if (!node) return null
  if (node.type === 'StringLiteral') return node.value as string
  if (node.type === 'TemplateLiteral') {
    return (node.quasis as Node[])
      .map((quasi) => (quasi.value as { cooked: string }).cooked)
      .join(VALUE)
  }
  if (node.type === 'JSXExpressionContainer') return literal(node.expression as Node)
  return null
}

/**
 * The texts a choice or a fallback shows (`a ? 'Save' : 'Saving…'`,
 * `name ?? 'Unnamed'`, `label || 'Remove'`): the literal at each branch, never
 * the condition or the left side of an `&&`.
 */
function branchLiterals(node: Node | null | undefined): string[] {
  if (!node) return []
  if (node.type === 'JSXExpressionContainer') return branchLiterals(node.expression as Node)
  if (node.type === 'ConditionalExpression') {
    return [...branchLiterals(node.consequent as Node), ...branchLiterals(node.alternate as Node)]
  }
  if (node.type === 'LogicalExpression') {
    const right = branchLiterals(node.right as Node)
    return node.operator === '&&' ? right : [...branchLiterals(node.left as Node), ...right]
  }
  const text = literal(node)
  return text === null ? [] : [text]
}

/** A choice or a fallback, whose branches `branchLiterals` reads. */
function isBranching(node: Node | null | undefined): boolean {
  const inner = node?.type === 'JSXExpressionContainer' ? (node.expression as Node) : node
  return inner?.type === 'ConditionalExpression' || inner?.type === 'LogicalExpression'
}

function calleeName(node: Node): string {
  if (node.type === 'Identifier') return node.name as string
  if (node.type === 'MemberExpression' && !node.computed) {
    const object = calleeName(node.object as Node)
    return object ? `${object}.${(node.property as Node).name as string}` : ''
  }
  return ''
}

function jsxName(node: Node): string {
  if (node.type === 'JSXIdentifier') return node.name as string
  if (node.type === 'JSXMemberExpression') {
    return `${jsxName(node.object as Node)}.${jsxName(node.property as Node)}`
  }
  return ''
}

function keyName(node: Node): string | null {
  const key = node.key as Node
  if (node.computed) return null
  if (key.type === 'Identifier') return key.name as string
  if (key.type === 'StringLiteral') return key.value as string
  return null
}

/** A message descriptor (`{ id, defaultMessage, description }`): its fields are the catalog's. */
function isMessageDescriptor(object: Node): boolean {
  return (object.properties as Node[]).some(
    (property) => property.type === 'ObjectProperty' && keyName(property) === 'defaultMessage'
  )
}

export function scanEnglish(source: string, file: string): Finding[] {
  const program = parseSource(source, file)
  if (!program) return []
  const findings: Finding[] = []
  const add = (
    node: Node,
    text: string,
    show: (text: string) => string = (t) => `"${t}"`,
    loose = false
  ) => {
    const collapsed = text.replace(/\s+/g, ' ').trim()
    if (!hasWords(collapsed.replaceAll(VALUE, ' ').trim(), loose)) return
    findings.push({ line: node.loc?.start.line ?? 0, text: show(collapsed) })
  }

  walk(program, (node, parent) => {
    switch (node.type) {
      case 'JSXText':
        add(node, node.value as string, undefined, true)
        return
      case 'JSXExpressionContainer': {
        // `{busy ? 'Saving…' : 'Save'}` between tags shows one of its texts.
        const child = parent?.type === 'JSXElement' || parent?.type === 'JSXFragment'
        if (child && isBranching(node)) {
          for (const text of branchLiterals(node)) add(node, text, undefined, true)
        }
        return
      }
      case 'JSXOpeningElement': {
        // A <FormattedMessage>'s attributes are its catalog entry.
        if (jsxName(node.name as Node) === 'FormattedMessage') return false
        return
      }
      case 'JSXAttribute': {
        const name = jsxName(node.name as Node)
        if (!READ_PROPS.has(name)) return
        const value = node.value as Node
        const texts = isBranching(value) ? branchLiterals(value) : [literal(value)]
        for (const text of texts) if (text !== null) add(node, text, (t) => `${name}="${t}"`, true)
        return
      }
      case 'CallExpression': {
        const callee = calleeName(node.callee as Node)
        if (/(^|\.)(formatMessage|defineMessages?)$/.test(callee)) return false
        if (!READ_CALLS.test(callee)) return
        const first = (node.arguments as Node[])[0]
        const texts = isBranching(first) ? branchLiterals(first) : [literal(first)]
        for (const text of texts) if (text !== null) add(node, text, (t) => `${callee}("${t}")`)
        return
      }
      case 'ObjectExpression':
        if (isMessageDescriptor(node)) return false
        return
      case 'ObjectProperty': {
        const name = keyName(node)
        if (!name || !READ_PROPS.has(name)) return
        const value = node.value as Node
        const texts = isBranching(value) ? branchLiterals(value) : [literal(value)]
        // A field that starts with a capital reads as copy; a lowercase one
        // is usually a value (an icon name, a key).
        for (const text of texts) {
          if (text !== null && /^[A-Z]/.test(text)) add(node, text, (t) => `${name}: "${t}"`)
        }
        return
      }
      default:
        return
    }
  })
  return findings
}
