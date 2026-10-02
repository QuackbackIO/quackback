/**
 * Guard: dates and numbers in `components/` and `routes/` are formatted the
 * same way on the server and in the hydrating browser.
 *
 * The server runs in its own locale and time zone, and the viewer's browser in
 * theirs. Text formatted with either runtime default reads differently on the
 * two sides, so a server-rendered one fails hydration (minified React error
 * 418) and the page re-renders on the client. Each rule below names one way
 * that happens and the fix. A file that only formats on the client (after a
 * user action, in an effect, inside an overlay) is listed in its rule's
 * allowlist with the reason; a listed file that no longer offends fails the
 * guard, so the lists only shrink.
 *
 * Sources are parsed with @babel/parser, so calls split over lines are seen
 * and comments are not. The parser does not know types, so a call is read as
 * a date or a number format from what the syntax shows:
 *   - `toLocaleDateString`, `toLocaleTimeString`, `Intl.DateTimeFormat` and
 *     date-fns formatting are dates; `Intl.NumberFormat` is a number.
 *   - `toLocaleString` is a date when its receiver is `new Date(...)` or a
 *     name the file binds to one or types `Date`, or when its options hold
 *     date fields. Every other `toLocaleString` is taken as a number.
 *   - Options passed as anything but an object literal, or a name the file
 *     binds to one, are not read (a spread, a parameter), so such a call never
 *     counts as missing a time zone.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse, type ParserPlugin } from '@babel/parser'
import { describe, expect, it } from 'vitest'

/** Paths relative to `apps/web/src`. */
const PRIMITIVE = 'components/ui/local-date.tsx'

type Rule = 'default-locale-date' | 'default-locale-number' | 'unzoned-date' | 'date-fns-format'

const FIX: Record<Rule, string> = {
  'default-locale-date':
    'format these dates with <LocalDate> or useLocalDateFormatter() from components/ui/local-date',
  'default-locale-number':
    "format these numbers with useFormatNumber() from components/ui/format-number (the app's locale)",
  'unzoned-date':
    'name a timeZone (UTC for a UTC bucket or a calendar date), or render a moment through <LocalDate>',
  'date-fns-format': 'date-fns formats in the runtime zone; render through <LocalDate> instead',
}

const ALLOWLIST: Record<Rule, Record<string, string>> = {
  'default-locale-date': {
    'components/admin/status/status-lifecycle-stepper.tsx':
      'Renders only in the incident editor, which opens in a dialog that mounts after hydration.',
    'components/conversation/snooze-natural-input.tsx':
      'The "Snoozes until" preview shows after the agent submits a phrase, in the custom snooze dialog.',
    'components/ui/mention-hover-card-overlay.tsx':
      'The "Joined" date is in a popover that opens when a mention is hovered.',
    'routes/admin/settings.office-hours.tsx':
      'Reads the zone in the enable toggle handler; the "opens" label renders once an effect sets now.',
  },
  'default-locale-number': {},
  'unzoned-date': {},
  'date-fns-format': {},
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

/** date-fns functions that print a date in the runtime's zone. */
const DATE_FNS_FORMATTERS = new Set([
  'format',
  'formatDate',
  'lightFormat',
  'formatISO',
  'formatISO9075',
  'formatRFC3339',
  'intlFormat',
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

const isMember = (node: Node) =>
  node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression'

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

interface Bindings {
  /** Names bound to a Date: `const d = new Date(...)` or `d: Date`. */
  dates: Set<string>
  /** Names bound to an object literal: `const OPTIONS = { ... }`. */
  objects: Map<string, Node>
  /** Local names of the date-fns formatters the file imports. */
  dateFns: Set<string>
  /** Local names of `import * as x from 'date-fns'`. */
  dateFnsNamespaces: Set<string>
}

function bindings(ast: Node): Bindings {
  const out: Bindings = {
    dates: new Set(),
    objects: new Map(),
    dateFns: new Set(),
    dateFnsNamespaces: new Set(),
  }
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && isIdentifier(node.id)) {
      const name = (node.id as Node).name as string
      if (constructsDate(node.init as Node) || annotatedDate(node.id as Node)) out.dates.add(name)
      let init = node.init as Node | null
      if (init?.type === 'TSAsExpression' || init?.type === 'TSSatisfiesExpression') {
        init = init.expression as Node
      }
      if (init?.type === 'ObjectExpression') out.objects.set(name, init)
    } else if (node.type === 'Identifier' && annotatedDate(node)) {
      out.dates.add(node.name as string)
    } else if (node.type === 'ImportDeclaration') {
      const source = (node.source as Node).value as string
      if (source !== 'date-fns' && !source.startsWith('date-fns/')) return
      for (const specifier of node.specifiers as Node[]) {
        const local = (specifier.local as Node).name as string
        if (specifier.type === 'ImportNamespaceSpecifier') {
          out.dateFnsNamespaces.add(local)
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          if (DATE_FNS_FORMATTERS.has(source.slice('date-fns/'.length))) out.dateFns.add(local)
        } else {
          const imported = specifier.imported as Node
          if (DATE_FNS_FORMATTERS.has((imported.name ?? imported.value) as string)) {
            out.dateFns.add(local)
          }
        }
      }
    }
  })
  return out
}

/** No locale, `undefined` or `[]`: the runtime's default locale. */
function defaultLocale(arg: Node | undefined): boolean {
  if (!arg) return true
  if (isIdentifier(arg, 'undefined')) return true
  if (arg.type === 'ArrayExpression') return (arg.elements as unknown[]).length === 0
  return arg.type === 'UnaryExpression' && arg.operator === 'void'
}

/** The option keys of an object literal, or null when they cannot be read. */
function optionKeys(arg: Node | undefined, b: Bindings): Set<string> | null {
  if (!arg) return new Set()
  const object = arg.type === 'Identifier' ? b.objects.get(arg.name as string) : arg
  if (!object || object.type !== 'ObjectExpression') return null
  const keys = new Set<string>()
  for (const property of object.properties as Node[]) {
    if (property.type === 'SpreadElement') return null
    const key = property.key as Node | undefined
    const name = key?.type === 'Identifier' ? key.name : key?.value
    if (typeof name === 'string') keys.add(name)
  }
  return keys
}

function hasDateOptions(arg: Node | undefined, b: Bindings): boolean {
  const keys = optionKeys(arg, b)
  return !!keys && [...keys].some((key) => DATE_OPTION_KEYS.has(key))
}

function isDateReceiver(node: Node, b: Bindings): boolean {
  return constructsDate(node) || (isIdentifier(node) && b.dates.has(node.name as string))
}

function isIntl(callee: Node, name: 'DateTimeFormat' | 'NumberFormat'): boolean {
  return (
    isMember(callee) && isIdentifier(callee.object, 'Intl') && isIdentifier(callee.property, name)
  )
}

/** A date format with an explicit locale is zone-safe only when it names a zone. */
function unzoned(options: Node | undefined, b: Bindings): boolean {
  const keys = optionKeys(options, b)
  return !!keys && !keys.has('timeZone')
}

/** Every offending line in a source file, per rule. */
function offences(file: string, src: string): Map<Rule, number[]> {
  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  const ast = parse(src, { sourceType: 'module', plugins }) as unknown as Node
  const b = bindings(ast)
  const found = new Map<Rule, number[]>()
  const add = (rule: Rule, node: Node) => {
    const line = (node.loc as { start: { line: number } }).start.line
    found.set(rule, [...(found.get(rule) ?? []), line])
  }
  walk(ast, (node) => {
    if (!['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(node.type)) return
    const callee = node.callee as Node
    const [locale, options] = node.arguments as Node[]

    if (isIntl(callee, 'DateTimeFormat')) {
      if (defaultLocale(locale)) add('default-locale-date', node)
      else if (unzoned(options, b)) add('unzoned-date', node)
      return
    }
    if (isIntl(callee, 'NumberFormat')) {
      if (defaultLocale(locale)) add('default-locale-number', node)
      return
    }
    if (node.type === 'NewExpression') return

    if (callee.type === 'Identifier' && b.dateFns.has(callee.name as string)) {
      add('date-fns-format', node)
      return
    }
    if (!isMember(callee) || callee.computed || !isIdentifier(callee.property)) return
    const method = (callee.property as Node).name as string
    const receiver = callee.object as Node
    if (isIdentifier(receiver) && b.dateFnsNamespaces.has(receiver.name as string)) {
      if (DATE_FNS_FORMATTERS.has(method)) add('date-fns-format', node)
      return
    }

    let isDate: boolean
    if (method === 'toLocaleDateString' || method === 'toLocaleTimeString') isDate = true
    else if (method === 'toLocaleString')
      isDate = isDateReceiver(receiver, b) || hasDateOptions(options, b)
    else return

    if (defaultLocale(locale)) add(isDate ? 'default-locale-date' : 'default-locale-number', node)
    else if (isDate && unzoned(options, b)) add('unzoned-date', node)
  })
  return found
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

/** Offending files under components/ and routes/, per rule, each with its lines. */
function scan(): Map<Rule, Map<string, number[]>> {
  const result = new Map<Rule, Map<string, number[]>>(
    (Object.keys(FIX) as Rule[]).map((rule) => [rule, new Map()])
  )
  const files = [
    ...sourceFiles(join(SRC_ROOT, 'components')),
    ...sourceFiles(join(SRC_ROOT, 'routes')),
  ]
  for (const file of files.sort()) {
    if (!/\.tsx?$/.test(file) || SKIP.test(file) || file === PRIMITIVE) continue
    for (const [rule, lines] of offences(file, readFileSync(join(SRC_ROOT, file), 'utf8'))) {
      result.get(rule)!.set(file, lines)
    }
  }
  return result
}

const offenders = scan()

describe.each(Object.keys(FIX) as Rule[])('SSR formats: %s', (rule) => {
  const found = offenders.get(rule)!
  const allowed = ALLOWLIST[rule]

  it('has no offenders outside the allowlist', () => {
    const unlisted = [...found]
      .filter(([file]) => !(file in allowed))
      .map(([file, lines]) => `${file}:${lines.join(',')}`)
    expect(unlisted, FIX[rule]).toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(allowed).filter((file) => !found.has(file))
    expect(stale, 'remove these files from the allowlist').toEqual([])
  })
})

describe('offences', () => {
  const rules = (src: string, file = 'example.tsx') => [...offences(file, src).keys()]

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
  ])('reads %s as a default-locale date', (_name, src) => {
    expect(rules(src)).toEqual(['default-locale-date'])
  })

  it.each([
    ['a count', 'count.toLocaleString()'],
    ['a member count', 'entry.viewCount.toLocaleString()'],
    ['an expression', 'Math.round(total / count).toLocaleString()'],
    ['number options', 'n.toLocaleString(undefined, { maximumFractionDigits: 1 })'],
    ['new Intl.NumberFormat()', 'new Intl.NumberFormat().format(n)'],
    ['Intl.NumberFormat(undefined, ...)', "Intl.NumberFormat(undefined, { style: 'percent' })"],
  ])('reads %s as a default-locale number', (_name, src) => {
    expect(rules(src)).toEqual(['default-locale-number'])
  })

  it.each([
    ['toLocaleDateString with a locale', "d.toLocaleDateString('en-US', { month: 'short' })"],
    ['toLocaleTimeString with a locale', "d.toLocaleTimeString('en-US')"],
    ['a locale variable', "d.toLocaleDateString(intl.locale, { day: 'numeric' })"],
    ['toLocaleString on a Date', "new Date(at).toLocaleString('en-US', { hour: 'numeric' })"],
    ['an Intl formatter', "new Intl.DateTimeFormat('en-US', { month: 'short' })"],
    ['options bound to a name', "const O = { day: 'numeric' }\nd.toLocaleDateString('en-US', O)"],
  ])('reads %s with no time zone as unzoned', (_name, src) => {
    expect(rules(src)).toEqual(['unzoned-date'])
  })

  it.each([
    ['format', "import { format } from 'date-fns'\nformat(d, 'MMM d')"],
    ['a renamed import', "import { format as fmt } from 'date-fns'\nfmt(d, 'MMM d')"],
    ['formatISO', "import { formatISO } from 'date-fns'\nformatISO(d)"],
    ['a namespace import', "import * as dfns from 'date-fns'\ndfns.format(d, 'MMM d')"],
    ['a default import of the module', "import format from 'date-fns/format'\nformat(d, 'p')"],
  ])('reads date-fns %s as a runtime-zone format', (_name, src) => {
    expect(rules(src)).toEqual(['date-fns-format'])
  })

  it.each([
    ['a named zone', "d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })"],
    [
      'a zone in bound options',
      "const O = { timeZone: 'UTC' }\nnew Intl.DateTimeFormat('en-US', O)",
    ],
    ['options that cannot be read', "new Intl.DateTimeFormat('en-US', { ...base })"],
    ['a currency with a locale', "(cents / 100).toLocaleString('en-US', { style: 'currency' })"],
    ['a number with a locale', "Intl.NumberFormat('de-DE').format(n)"],
    [
      'date-fns relative time',
      "import { formatDistanceToNow } from 'date-fns'\nformatDistanceToNow(d)",
    ],
    ['a local function named format', "const format = (d: Date) => ''\nformat(d)"],
    ['a comment', '// d.toLocaleDateString()\nconst x = 1'],
    ['a string', "const s = 'toLocaleDateString()'"],
  ])('passes %s', (_name, src) => {
    expect(rules(src)).toEqual([])
  })

  it('reports the line of each offending call', () => {
    const src = 'const a = 1\nnew Date(x).toLocaleDateString()\nconst b = 2\nd.toLocaleTimeString()'
    expect(offences('example.ts', src).get('default-locale-date')).toEqual([2, 4])
  })
})
