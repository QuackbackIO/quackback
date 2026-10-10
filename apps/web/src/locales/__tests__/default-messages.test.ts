/**
 * Guard: the English a message carries in code is its en.json English, word
 * for word. Admin pages in English render straight from the code rather than
 * seeding en.json (see the admin layout loader), so a message whose code
 * drifted from the catalog would read one way there and another wherever
 * en.json is seeded, with every translation following the catalog's version.
 *
 * Code names a message's English beside its id: `id` with `defaultMessage` (a
 * descriptor or a `<FormattedMessage>`), or `<x>Id` with `<x>`, `default<X>`
 * or `<x>Default` (`labelId: 'admin.nav.home', label: 'Home'`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse, type ParserPlugin } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import en from '../en.json'

type Node = { type: string; [key: string]: unknown }

const CATALOG = en as Record<string, string>
const SRC_ROOT = join(import.meta.dirname, '..', '..')
const SKIP = /(^|\/)__tests__\/|\.test\.tsx?$|\.d\.ts$/
const SKIPPED_KEYS = new Set([
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

interface Pair {
  at: string
  id: string
  english: string
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!node || typeof node !== 'object' || typeof (node as Node).type !== 'string') return
  visit(node as Node)
  for (const [key, child] of Object.entries(node)) {
    if (!SKIPPED_KEYS.has(key) && child && typeof child === 'object') walk(child, visit)
  }
}

/** The string a literal, or a concatenation of literals, spells; else null. */
function stringOf(node: Node | null | undefined): string | null {
  if (!node) return null
  switch (node.type) {
    case 'StringLiteral':
      return node.value as string
    case 'TemplateLiteral':
      if ((node.expressions as Node[]).length > 0) return null
      return ((node.quasis as Node[])[0].value as { cooked: string }).cooked
    case 'BinaryExpression': {
      if (node.operator !== '+') return null
      const left = stringOf(node.left as Node)
      const right = stringOf(node.right as Node)
      return left === null || right === null ? null : left + right
    }
    case 'JSXExpressionContainer':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'ParenthesizedExpression':
      return stringOf(node.expression as Node)
    default:
      return null
  }
}

/** The names that may carry the English for an id named `name`. */
function englishNames(name: string): string[] {
  if (name === 'id') return ['defaultMessage']
  const base = name.slice(0, -'Id'.length)
  const capital = base[0].toUpperCase() + base.slice(1)
  return [base, `default${capital}`, `${base}Default`, 'defaultMessage']
}

/** Each id-and-English pair named side by side in one object or one JSX tag. */
function pairsIn(fields: Map<string, Node>, at: string, out: Pair[]): void {
  for (const [name, value] of fields) {
    if (name !== 'id' && !/^[a-z]\w*Id$/.test(name)) continue
    const id = stringOf(value)
    if (id === null || !(id in CATALOG)) continue
    for (const englishName of englishNames(name)) {
      const english = stringOf(fields.get(englishName))
      if (english !== null) {
        out.push({ at, id, english })
        break
      }
    }
  }
}

export function messagePairs(file: string, src: string): Pair[] {
  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  const ast = parse(src, { sourceType: 'module', plugins })
  const out: Pair[] = []
  walk(ast, (node) => {
    const at = `${file}:${(node.loc as { start: { line: number } } | undefined)?.start.line}`
    if (node.type === 'ObjectExpression') {
      const fields = new Map<string, Node>()
      for (const prop of node.properties as Node[]) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue
        const key = prop.key as Node
        const name = key.type === 'Identifier' ? key.name : stringOf(key)
        if (typeof name === 'string') fields.set(name, prop.value as Node)
      }
      pairsIn(fields, at, out)
    } else if (node.type === 'JSXOpeningElement') {
      const fields = new Map<string, Node>()
      for (const attr of node.attributes as Node[]) {
        if (attr.type !== 'JSXAttribute') continue
        const name = (attr.name as Node).name
        if (typeof name === 'string' && attr.value) fields.set(name, attr.value as Node)
      }
      pairsIn(fields, at, out)
    }
  })
  return out
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else out.push(relative(SRC_ROOT, full).split('\\').join('/'))
  }
  return out
}

function allPairs(): Pair[] {
  const pairs: Pair[] = []
  for (const file of sourceFiles(SRC_ROOT).sort()) {
    if (!/\.tsx?$/.test(file) || SKIP.test(file)) continue
    pairs.push(...messagePairs(file, readFileSync(join(SRC_ROOT, file), 'utf8')))
  }
  return pairs
}

describe('message pairs', () => {
  const ids = (src: string, file = 'x.tsx') =>
    messagePairs(file, src).map((pair) => [pair.id, pair.english])

  it('reads a descriptor, a <FormattedMessage> and a split literal', () => {
    expect(
      ids(`
        intl.formatMessage({ id: 'admin.nav.home', defaultMessage: 'Home' })
        const a = <FormattedMessage id="admin.nav.users" defaultMessage={'Us' + 'ers'} />
      `)
    ).toEqual([
      ['admin.nav.home', 'Home'],
      ['admin.nav.users', 'Users'],
    ])
  })

  it('reads <x>Id beside <x>, default<X> and <x>Default', () => {
    expect(
      ids(`
        const a = { label: 'Home', labelId: 'admin.nav.home' }
        const b = { labelId: 'admin.nav.users', defaultLabel: 'Users' }
        const c = <Card titleId="admin.nav.roadmap" titleDefault="Roadmap" />
      `)
    ).toEqual([
      ['admin.nav.home', 'Home'],
      ['admin.nav.users', 'Users'],
      ['admin.nav.roadmap', 'Roadmap'],
    ])
  })

  it('skips ids outside the catalog and English it cannot read', () => {
    expect(
      ids(`
        const a = { id: 'not.a.catalog.key', defaultMessage: 'Nope' }
        const b = { id: 'admin.nav.home', defaultMessage: label }
        const c = { id: 'admin.nav.users', defaultMessage: \`Hi \${name}\` }
      `)
    ).toEqual([])
  })
})

describe('code English', () => {
  const pairs = allPairs()

  it('finds the messages it guards', () => {
    // Far fewer would mean the reader stopped seeing them, not that they went.
    expect(pairs.length).toBeGreaterThan(1500)
  })

  it('matches en.json for every message', () => {
    const drift = pairs
      .filter((pair) => CATALOG[pair.id] !== pair.english)
      .map((pair) => `${pair.at} ${pair.id}\n  code: ${pair.english}\n  en:   ${CATALOG[pair.id]}`)
    expect(drift).toEqual([])
  })
})
