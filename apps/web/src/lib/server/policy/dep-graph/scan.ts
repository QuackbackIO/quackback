/**
 * Static import scanner for the dependency-graph snapshot.
 *
 * Walks a source tree and, via the TypeScript AST, extracts every module
 * specifier a file names:
 *   - static `import ... from 'x'` (type-only included: compile-time coupling
 *     is still coupling)
 *   - `export ... from 'x'` re-exports
 *   - dynamic `import('x')` with a string-literal argument (non-literal
 *     arguments cannot be resolved statically and are skipped)
 *
 * `require(...)` is not scanned: the codebase is ESM throughout.
 *
 * AST-only, no type-checker: parse-and-walk covers the whole tree in
 * well under the 5s budget (measured ~1.5s), and cannot be fooled by
 * import-shaped text in comments or strings.
 */
import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { posix } from 'node:path'
import { walkSourceFiles } from '../source-files'

export interface ImportRef {
  specifier: string
  kind: 'static' | 'export-from' | 'dynamic'
}

export interface ScannedFile {
  /** Path relative to the scanned root, posix-normalized. */
  relPath: string
  imports: ImportRef[]
}

/** Extract every statically-known module specifier from one file's text. */
export function extractImports(relPath: string, text: string): ImportRef[] {
  const sf = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const refs: ImportRef[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ specifier: node.moduleSpecifier.text, kind: 'static' })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        refs.push({ specifier: node.moduleSpecifier.text, kind: 'export-from' })
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      refs.push({ specifier: node.arguments[0].text, kind: 'dynamic' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return refs
}

/**
 * Resolve a specifier written in a file under apps/web/src to a src-relative
 * path. Returns null for anything that does not land inside src: bare npm
 * specifiers, workspace packages, and relative paths that escape the root.
 * Vite query suffixes (`?url`, `?raw`) are stripped first.
 */
export function resolveSrcSpecifier(fromRelPath: string, specifier: string): string | null {
  const spec = specifier.split('?')[0]
  if (spec.startsWith('@/')) return posix.normalize(spec.slice(2))
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const resolved = posix.join(posix.dirname(fromRelPath), spec)
    return resolved.startsWith('..') ? null : resolved
  }
  return null
}

/**
 * The bucket a src-relative path belongs to: its top-level directory, with
 * `lib` split one level deeper (lib/client, lib/server, lib/shared). Files
 * sitting directly in src (router.tsx, routeTree.gen.ts, ...) form `(root)`.
 */
export function bucketOf(srcRelPath: string): string {
  const parts = srcRelPath.split('/')
  if (parts.length === 1) return '(root)'
  if (parts[0] === 'lib') return `lib/${parts[1]}`
  return parts[0]
}

const DOMAINS_PREFIX = 'lib/server/domains/'

/** The domain a src-relative path (file or import target) belongs to, or null. */
export function domainOf(srcRelPath: string): string | null {
  if (!srcRelPath.startsWith(DOMAINS_PREFIX)) return null
  const segment = srcRelPath.slice(DOMAINS_PREFIX.length).split('/')[0]
  return segment.length > 0 ? segment : null
}

/** Scan every source file under a root, sorted by path for determinism. */
export function scanTree(rootAbs: string): ScannedFile[] {
  const files: ScannedFile[] = []
  for (const absPath of walkSourceFiles(rootAbs)) {
    const relPath = relative(rootAbs, absPath).split('\\').join('/')
    files.push({ relPath, imports: extractImports(relPath, readFileSync(absPath, 'utf8')) })
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return files
}
