/**
 * Reading a post must not download the code for writing one.
 *
 * The post page and its comment renderers display stored TipTap JSON through
 * the light read renderer (`RichTextContent`). The editor, the markdown
 * converter and the emoji dataset each outweigh the rest of the page, so they
 * sit behind lazy boundaries and load only when a visitor starts composing or
 * a legacy markdown-only comment needs parsing. One static import is enough to
 * pull any of them back into every post view, so this walks the runtime static
 * import graph from each reading surface and fails with the offending chain.
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

const READING_SURFACES = [
  'routes/_portal.b.$slug.posts.$postId.tsx',
  'components/public/comment-content.tsx',
  'components/public/comment-thread.tsx',
  'components/public/pinned-comment.tsx',
  'components/public/post-content.tsx',
]

const HEAVY_MODULES: Record<string, string> = {
  'components/ui/rich-text-editor.tsx': 'the rich-text editor',
  'lib/server/markdown-tiptap.ts': 'the markdown converter',
  'lib/shared/content-emoji.ts': 'the emoji dataset',
}

const HEAVY_PACKAGES: { pattern: RegExp; what: string }[] = [
  { pattern: /^@tiptap\//, what: 'tiptap' },
  { pattern: /^tiptap-extension-/, what: 'tiptap' },
  { pattern: /^prosemirror-/, what: 'prosemirror' },
  { pattern: /^(lowlight|highlight\.js)(\/|$)/, what: 'syntax highlighting' },
  { pattern: /^marked(\/|$)/, what: 'the markdown parser' },
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
function heavyReachableFrom(entry: string): string[] {
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
    if (HEAVY_MODULES[rel]) {
      found.push(`${HEAVY_MODULES[rel]}: ${chain(file)}`)
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
      const heavy = HEAVY_PACKAGES.find(({ pattern }) => pattern.test(specifier))
      if (heavy) found.push(`${heavy.what} (${specifier}): ${chain(file)}`)
    }
  }
  return found
}

describe('post reading surfaces', () => {
  it.each(READING_SURFACES)('%s reaches no editor, markdown or emoji code eagerly', (entry) => {
    expect(heavyReachableFrom(entry)).toEqual([])
  })

  it('reports a heavy module reached through a static import, not a lazy one', () => {
    expect(heavyReachableFrom('components/ui/lazy-rich-text-editor.tsx')).toEqual([])
    expect(heavyReachableFrom('lib/server/domains/comments/comment-content.ts')).toContainEqual(
      'the markdown converter: lib/server/domains/comments/comment-content.ts -> lib/server/markdown-tiptap.ts'
    )
  })
})
