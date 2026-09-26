/**
 * Opening an admin list page must not download the code for editing an item.
 *
 * The changelog and help center lists open an entry in a modal the admin
 * layout loads lazily, and create one in a dialog opened from the list. The
 * editor behind both (tiptap, prosemirror, highlight.js) and the form code
 * around it outweigh the list itself, so they load the first time an entry is
 * opened or created. One static import pulls them back onto every visit, so
 * this walks the runtime static import graph from each list page and fails
 * with the offending chain.
 *
 * Type-only imports and dynamic `import()` are not edges: neither ships code
 * eagerly. Server function modules (`lib/server/functions/*`) are leaves: the
 * client build replaces their handlers with RPC stubs.
 */
import { describe, expect, it } from 'vitest'
import * as ts from '@typescript/typescript6'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../..')

const LIST_PAGES = [
  // The layout around every admin page, which opens the entity modals.
  'routes/admin.tsx',
  'routes/admin/changelog.tsx',
  'routes/admin/help-center.tsx',
  'routes/admin/help-center.index.tsx',
]

const HEAVY_MODULES: Record<string, string> = {
  'components/ui/rich-text-editor.tsx': 'the rich-text editor',
  'components/ui/datetime-picker.tsx': 'the date-time picker',
  'components/admin/changelog/changelog-modal.tsx': 'the changelog entry modal',
  'components/admin/help-center/article-modal.tsx': 'the article modal',
  'components/admin/feedback/post-modal.tsx': 'the post modal',
}

const HEAVY_PACKAGES: { pattern: RegExp; what: string }[] = [
  { pattern: /^@tiptap\//, what: 'tiptap' },
  { pattern: /^tiptap-extension-/, what: 'tiptap' },
  { pattern: /^prosemirror-/, what: 'prosemirror' },
  { pattern: /^(lowlight|highlight\.js)(\/|$)/, what: 'syntax highlighting' },
  { pattern: /^react-hook-form(\/|$)/, what: 'the form library' },
]

function isTypeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true
    const clause = node.exportClause
    return !!clause && ts.isNamedExports(clause) && clause.elements.every((e) => e.isTypeOnly)
  }
  const clause = node.importClause
  if (!clause) return false // `import 'x'` runs for its side effects
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const bindings = clause.namedBindings
  return !!bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly)
}

/** Specifiers a file imports at runtime, statically. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const out: string[] = []
  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !isTypeOnly(statement)
    ) {
      out.push(statement.moduleSpecifier.text)
    }
  }
  return out
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

/** Every heavy module or package reachable from `entry`, with the chain that reaches it. */
function heavyReachableFrom(
  entry: string,
  heavy = { modules: HEAVY_MODULES, packages: HEAVY_PACKAGES }
): string[] {
  const start = path.join(SRC, entry)
  const parent = new Map<string, string | null>([[start, null]])
  const queue = [start]
  const found: string[] = []
  const chain = (file: string) => {
    const links: string[] = []
    for (let at: string | null = file; at; at = parent.get(at) ?? null) {
      links.unshift(path.relative(SRC, at))
    }
    return links.join(' -> ')
  }

  while (queue.length > 0) {
    const file = queue.shift()!
    const rel = path.relative(SRC, file)
    if (heavy.modules[rel]) {
      found.push(`${heavy.modules[rel]}: ${chain(file)}`)
      continue
    }
    if (rel.startsWith('lib/server/functions/') || !/\.tsx?$/.test(file)) continue
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith('@/') || specifier.startsWith('.')) {
        const resolved = resolveLocal(file, specifier)
        if (resolved && !parent.has(resolved)) {
          parent.set(resolved, file)
          queue.push(resolved)
        }
        continue
      }
      const heavyPackage = heavy.packages.find(({ pattern }) => pattern.test(specifier))
      if (heavyPackage) found.push(`${heavyPackage.what} (${specifier}): ${chain(file)}`)
    }
  }
  return found
}

describe('admin list pages', () => {
  it.each(LIST_PAGES)('%s reaches no editor or entry form code eagerly', (entry) => {
    expect(heavyReachableFrom(entry)).toEqual([])
  })
})
