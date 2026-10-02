/**
 * Guard: no absolute date in `components/` or `routes/` is formatted with the
 * runtime's default locale or time zone outside the LocalDate primitive.
 *
 * The server and the viewer's browser format such a date differently, so a
 * server-rendered one fails hydration (minified React error 418) and the page
 * re-renders on the client. Render dates through `<LocalDate>` or
 * `useLocalDateFormatter()` instead. A file that only formats on the client
 * (after a user action, in an effect, inside an overlay) or only for server
 * output is listed in ALLOWLIST with its reason; the guard fails on a listed
 * file that no longer offends, so the list only shrinks.
 *
 * Sources are parsed with @babel/parser, so calls split over lines are seen
 * and comments are not.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse, type ParserPlugin } from '@babel/parser'
import { describe, expect, it } from 'vitest'

/** Paths relative to `apps/web/src`. */
const PRIMITIVE = 'components/ui/local-date.tsx'

const ALLOWLIST: Record<string, string> = {
  'components/admin/status/status-lifecycle-stepper.tsx':
    'Renders only in the incident editor, which opens in a dialog that mounts after hydration.',
  'components/conversation/snooze-natural-input.tsx':
    'The "Snoozes until" preview shows after the agent submits a phrase, in the custom snooze dialog.',
  'components/shared/conversation/ticket-header-card.tsx':
    'Intake date answers render once the visitor opens the Details disclosure, which fetches the form.',
  'components/ui/mention-hover-card-overlay.tsx':
    'The "Joined" date is in a popover that opens when a mention is hovered.',
  'routes/admin/settings.office-hours.tsx':
    'Reads the zone in the enable toggle handler; the "opens" label renders once an effect sets now.',
}

type Node = { type: string; [key: string]: unknown }

const SKIPPED_KEYS = new Set([
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

/** Options that make a `toLocaleString` call a date format, not a number format. */
const DATE_OPTION_KEYS = new Set([
  'dateStyle',
  'timeStyle',
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZone',
  'timeZoneName',
  'hour12',
  'hourCycle',
])

function children(node: Node): Node[] {
  const out: Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key) || value === null || typeof value !== 'object') continue
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item && typeof item === 'object' && typeof (item as Node).type === 'string') {
        out.push(item as Node)
      }
    }
  }
  return out
}

function walk(node: Node, visit: (node: Node) => void) {
  visit(node)
  for (const child of children(node)) walk(child, visit)
}

const isIdentifier = (node: unknown, name?: string): boolean =>
  !!node &&
  (node as Node).type === 'Identifier' &&
  (name === undefined || (node as Node).name === name)

/** `new Date(...)`, possibly behind a ternary or `??` / `||`. */
function constructsDate(node: Node | null | undefined): boolean {
  if (!node) return false
  switch (node.type) {
    case 'NewExpression':
      return isIdentifier(node.callee, 'Date')
    case 'ConditionalExpression':
      return constructsDate(node.consequent as Node) || constructsDate(node.alternate as Node)
    case 'LogicalExpression':
      return constructsDate(node.left as Node) || constructsDate(node.right as Node)
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return constructsDate(node.expression as Node)
    default:
      return false
  }
}

function annotatedDate(node: Node): boolean {
  const annotation = (node.typeAnnotation as Node | undefined)?.typeAnnotation as Node | undefined
  if (!annotation) return false
  const types =
    annotation.type === 'TSUnionType' ? (annotation.types as Node[]) : ([annotation] as Node[])
  return types.some(
    (type) => type.type === 'TSTypeReference' && isIdentifier(type.typeName, 'Date')
  )
}

/** Names the file binds to a Date: `const d = new Date(...)` or `d: Date`. */
function dateNames(ast: Node): Set<string> {
  const names = new Set<string>()
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && isIdentifier(node.id)) {
      if (constructsDate(node.init as Node) || annotatedDate(node.id as Node)) {
        names.add((node.id as Node).name as string)
      }
    } else if (node.type === 'Identifier' && annotatedDate(node)) {
      names.add(node.name as string)
    }
  })
  return names
}

/** No locale, `undefined` or `[]`: the runtime's default locale. */
function defaultLocale(arg: Node | undefined): boolean {
  if (!arg) return true
  if (isIdentifier(arg, 'undefined')) return true
  if (arg.type === 'ArrayExpression') return (arg.elements as unknown[]).length === 0
  return arg.type === 'UnaryExpression' && arg.operator === 'void'
}

function hasDateOptions(arg: Node | undefined): boolean {
  if (!arg || arg.type !== 'ObjectExpression') return false
  return (arg.properties as Node[]).some((property) => {
    const key = property.key as Node | undefined
    if (!key) return false
    const name = key.type === 'Identifier' ? key.name : key.value
    return typeof name === 'string' && DATE_OPTION_KEYS.has(name)
  })
}

function isDateReceiver(node: Node, names: Set<string>): boolean {
  return constructsDate(node) || (isIdentifier(node) && names.has(node.name as string))
}

function isIntlDateTimeFormat(callee: Node): boolean {
  return (
    (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
    isIdentifier(callee.object, 'Intl') &&
    isIdentifier(callee.property, 'DateTimeFormat')
  )
}

/** The 1-based lines of every date formatted with the runtime's default locale. */
function localeDefaultDateLines(file: string, src: string): number[] {
  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  const ast = parse(src, { sourceType: 'module', plugins }) as unknown as Node
  const names = dateNames(ast)
  const lines: number[] = []
  walk(ast, (node) => {
    if (!['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(node.type)) return
    const callee = node.callee as Node
    const args = node.arguments as Node[]
    let offends = false
    if (isIntlDateTimeFormat(callee)) {
      offends = defaultLocale(args[0])
    } else if (
      node.type !== 'NewExpression' &&
      (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
      !callee.computed &&
      isIdentifier(callee.property)
    ) {
      const method = (callee.property as Node).name
      if (method === 'toLocaleDateString' || method === 'toLocaleTimeString') {
        offends = defaultLocale(args[0])
      } else if (method === 'toLocaleString') {
        offends =
          defaultLocale(args[0]) &&
          (hasDateOptions(args[1]) || isDateReceiver(callee.object as Node, names))
      }
    }
    if (offends) lines.push((node.loc as { start: { line: number } }).start.line)
  })
  return lines
}

const SRC_ROOT = join(import.meta.dirname, '..', '..', '..')
const SKIP = /(^|\/)__tests__\/|\.test\.tsx?$|\.d\.ts$/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else out.push(relative(SRC_ROOT, full).split('\\').join('/'))
  }
  return out
}

/** Offending files under components/ and routes/, each with its offending lines. */
function scan(): Map<string, number[]> {
  const offenders = new Map<string, number[]>()
  const files = [
    ...sourceFiles(join(SRC_ROOT, 'components')),
    ...sourceFiles(join(SRC_ROOT, 'routes')),
  ]
  for (const file of files.sort()) {
    if (!/\.tsx?$/.test(file) || SKIP.test(file) || file === PRIMITIVE) continue
    const lines = localeDefaultDateLines(file, readFileSync(join(SRC_ROOT, file), 'utf8'))
    if (lines.length) offenders.set(file, lines)
  }
  return offenders
}

describe('locale-default date guard', () => {
  const offenders = scan()

  it('finds no locale-default date format outside the primitive and the allowlist', () => {
    const unlisted = [...offenders]
      .filter(([file]) => !(file in ALLOWLIST))
      .map(([file, lines]) => `${file}:${lines.join(',')}`)
    expect(
      unlisted,
      'format these dates with <LocalDate> or useLocalDateFormatter() from components/ui/local-date'
    ).toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => !offenders.has(file))
    expect(stale, 'remove these files from the allowlist').toEqual([])
  })
})

describe('localeDefaultDateLines', () => {
  const offends = (src: string) => localeDefaultDateLines('example.tsx', src).length > 0

  it.each([
    ['toLocaleDateString()', 'new Date(at).toLocaleDateString()'],
    [
      'toLocaleDateString(undefined, options)',
      "d.toLocaleDateString(undefined, { month: 'short' })",
    ],
    ['toLocaleTimeString([], options)', "d.toLocaleTimeString([], { hour: '2-digit' })"],
    ['toLocaleString on a new Date', 'new Date(at).toLocaleString()'],
    ['toLocaleString on a name bound to a Date', 'const d = new Date(at)\nd.toLocaleString()'],
    ['toLocaleString on a name typed Date', 'function f(d: Date) { return d.toLocaleString() }'],
    ['toLocaleString with date options', "x.toLocaleString(undefined, { dateStyle: 'medium' })"],
    [
      'new Intl.DateTimeFormat(undefined, ...)',
      "new Intl.DateTimeFormat(undefined, { day: 'numeric' })",
    ],
    ['Intl.DateTimeFormat()', 'Intl.DateTimeFormat().resolvedOptions().timeZone'],
    ['a call split over lines', 'd.toLocaleDateString(\n  undefined,\n  { year: "numeric" }\n)'],
    ['an optional call', 'd?.toLocaleDateString()'],
  ])('flags %s', (_name, src) => {
    expect(offends(src)).toBe(true)
  })

  it.each([
    ['a number', 'count.toLocaleString()'],
    ['a member number', 'entry.viewCount.toLocaleString()'],
    ['number options', 'n.toLocaleString(undefined, { maximumFractionDigits: 1 })'],
    ['an explicit locale', "d.toLocaleDateString('en-US', { month: 'short' })"],
    ['an explicit locale variable', 'd.toLocaleDateString(intl.locale)'],
    ['an Intl formatter with a locale', "new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' })"],
    ['a comment', '// d.toLocaleDateString()\nconst x = 1'],
    ['a string', "const s = 'toLocaleDateString()'"],
  ])('ignores %s', (_name, src) => {
    expect(offends(src)).toBe(false)
  })

  it('reports the line of each offending call', () => {
    const src = 'const a = 1\nnew Date(x).toLocaleDateString()\nconst b = 2\nd.toLocaleTimeString()'
    expect(localeDefaultDateLines('example.ts', src)).toEqual([2, 4])
  })
})
