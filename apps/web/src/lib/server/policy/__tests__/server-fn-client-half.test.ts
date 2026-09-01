/**
 * Server-function modules ship to the browser.
 *
 * `lib/server/functions/*.ts` is imported by client code (route loaders, query
 * options, components) to get the RPC stubs. The Start compiler strips the
 * body of every `.handler()` (and `createMiddleware().server()` /
 * `createServerOnlyFn()`) from the client half, then drops module-scope
 * bindings nothing else references any more. What survives is every export
 * and whatever those exports reach — including plain helper functions and
 * their `await import('@/lib/server/…')` calls, which drag the database/auth
 * graph into the browser's module graph. In dev that surfaces as
 * import-protection errors and a Vite dependency re-optimisation + forced
 * reload mid-navigation (a blank /admin page); in a production build it ships
 * whatever the tree-shaker cannot prove dead.
 *
 * So: in a server-function module, a dynamic import of a server-only module
 * must either sit inside a server-stripped scope or be unreachable from the
 * module's exports once those scopes are gone. Server-only helpers belong in a
 * domain module (`lib/server/domains/...`) and get imported from the handler.
 *
 * The reachability here is a syntactic approximation of the compiler's
 * dead-code elimination: top-level declarations form the nodes, identifier
 * mentions outside stripped scopes form the edges, exports and bare top-level
 * statements are the roots.
 */
import { describe, it, expect } from 'vitest'
import * as ts from '@typescript/typescript6'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walkSourceFiles } from '../source-files'

const SRC_ROOT = join(__dirname, '../../../..') // apps/web/src
const FUNCTIONS_ROOT = join(SRC_ROOT, 'lib/server/functions')

/** Modules that must never be reachable from the client half of a server-function file. */
export function isServerOnlySpecifier(spec: string): boolean {
  if (spec.startsWith('@/lib/server/functions/')) return false
  if (spec.startsWith('@/lib/server/')) return true
  return spec === '@quackback/db' || spec.startsWith('@quackback/db/')
}

/** Callee names whose function arguments the Start compiler removes from the client half. */
const SERVER_STRIPPED_CALLS = new Set(['handler', 'server', 'createServerOnlyFn'])

function isServerStrippedCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (ts.isPropertyAccessExpression(callee)) return SERVER_STRIPPED_CALLS.has(callee.name.text)
  if (ts.isIdentifier(callee)) return SERVER_STRIPPED_CALLS.has(callee.text)
  return false
}

export interface LeakedImport {
  file: string
  line: number
  specifier: string
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  )
}

function declaredNames(node: ts.Node): string[] {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    return node.name ? [node.name.text] : []
  }
  if (ts.isVariableStatement(node)) {
    const names: string[] = []
    const collect = (binding: ts.BindingName): void => {
      if (ts.isIdentifier(binding)) names.push(binding.text)
      else for (const el of binding.elements) if (ts.isBindingElement(el)) collect(el.name)
    }
    for (const decl of node.declarationList.declarations) collect(decl.name)
    return names
  }
  return []
}

/** Identifiers mentioned in `node`, skipping anything the compiler strips from the client half. */
function identifiersOutsideStrippedScopes(node: ts.Node): Set<string> {
  const names = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && isServerStrippedCall(n)) {
      // The callee chain (`createServerFn().handler`) stays; the arguments go.
      visit(n.expression)
      return
    }
    if (ts.isIdentifier(n)) names.add(n.text)
    ts.forEachChild(n, visit)
  }
  visit(node)
  return names
}

function serverOnlyDynamicImports(sf: ts.SourceFile, root: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = []
  const visit = (n: ts.Node): void => {
    if (isServerStrippedCall(n)) return
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      isServerOnlySpecifier(n.arguments[0].text)
    ) {
      found.push(n)
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
  return found
}

export function findLeakedServerImports(relPath: string, text: string): LeakedImport[] {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const byName = new Map<string, ts.Statement>()
  const roots: ts.Statement[] = []
  const exportedNames = new Set<string>()
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        exportedNames.add((el.propertyName ?? el.name).text)
      }
      continue
    }
    if (ts.isExportAssignment(stmt)) {
      roots.push(stmt)
      continue
    }
    const names = declaredNames(stmt)
    if (names.length === 0) {
      // Bare top-level statement (side effect): always in the client half.
      roots.push(stmt)
      continue
    }
    for (const name of names) byName.set(name, stmt)
    if (hasExportModifier(stmt)) roots.push(stmt)
  }
  for (const name of exportedNames) {
    const stmt = byName.get(name)
    if (stmt) roots.push(stmt)
  }

  const reachable = new Set<ts.Statement>()
  const queue = [...roots]
  while (queue.length > 0) {
    const stmt = queue.pop()!
    if (reachable.has(stmt)) continue
    reachable.add(stmt)
    for (const name of identifiersOutsideStrippedScopes(stmt)) {
      const dep = byName.get(name)
      if (dep && !reachable.has(dep)) queue.push(dep)
    }
  }

  const leaks: LeakedImport[] = []
  for (const stmt of sf.statements) {
    if (!reachable.has(stmt)) continue
    for (const call of serverOnlyDynamicImports(sf, stmt)) {
      const { line } = sf.getLineAndCharacterOfPosition(call.getStart(sf))
      leaks.push({
        file: relPath,
        line: line + 1,
        specifier: (call.arguments[0] as ts.StringLiteral).text,
      })
    }
  }
  return leaks
}

describe('findLeakedServerImports', () => {
  it('accepts a server import inside .handler()', () => {
    const src = `
      export const fn = createServerFn().handler(async () => {
        const { db } = await import('@/lib/server/db')
        return db
      })
    `
    expect(findLeakedServerImports('x.ts', src)).toEqual([])
  })

  it('accepts server imports inside createMiddleware().server() and createServerOnlyFn()', () => {
    const src = `
      export const mw = createMiddleware().server(async ({ next }) => {
        await import('@/lib/server/auth')
        return next()
      })
      export const only = createServerOnlyFn(async () => import('@/lib/server/db'))
    `
    expect(findLeakedServerImports('x.ts', src)).toEqual([])
  })

  it('accepts a helper only handlers reach: the compiler drops it from the client half', () => {
    const src = `
      async function loadCounts() {
        const { db } = await import('@/lib/server/db')
        return db
      }
      export const fn = createServerFn().handler(() => loadCounts())
    `
    expect(findLeakedServerImports('x.ts', src)).toEqual([])
  })

  it('flags an exported helper with a server import', () => {
    const src = `
      export async function assertFits() {
        const { db } = await import('@/lib/server/db')
        return db
      }
    `
    expect(findLeakedServerImports('x.ts', src)).toEqual([
      { file: 'x.ts', line: 3, specifier: '@/lib/server/db' },
    ])
  })

  it('follows references from exports into private helpers', () => {
    const src = `
      async function loadCounts() {
        const { db } = await import('@/lib/server/db')
        return db
      }
      export async function assertFits() {
        return loadCounts()
      }
    `
    expect(findLeakedServerImports('x.ts', src)).toEqual([
      { file: 'x.ts', line: 3, specifier: '@/lib/server/db' },
    ])
  })

  it('honours export lists and treats bare top-level statements as roots', () => {
    const listed = `
      async function viaList() { await import('@/lib/server/db') }
      export { viaList }
    `
    expect(findLeakedServerImports('x.ts', listed)).toHaveLength(1)

    const sideEffect = `
      async function warm() { await import('@/lib/server/cache') }
      void warm()
    `
    expect(findLeakedServerImports('x.ts', sideEffect)).toHaveLength(1)
  })

  it('ignores imports of other server-function modules and of shared code', () => {
    const src = `
      export async function helper() {
        await import('@/lib/server/functions/other')
        await import('@/lib/shared/permissions')
      }
    `
    expect(findLeakedServerImports('x.ts', src)).toEqual([])
  })
})

/**
 * Only modules that declare server functions are imported by the client for
 * their RPC stubs. A few server-only helper modules also live under
 * `functions/` (e.g. `origin-transfer.ts`, reached solely through
 * `createServerOnlyFn`) and never get a client half, so they are out of scope.
 */
function declaresServerFunctions(text: string): boolean {
  return /\bcreateServerFn\s*\(/.test(text)
}

describe('lib/server/functions client half', () => {
  it('never imports server-only modules outside a server-stripped scope', () => {
    const leaks = walkSourceFiles(FUNCTIONS_ROOT).flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      if (!declaresServerFunctions(text)) return []
      return findLeakedServerImports(relative(SRC_ROOT, file), text)
    })
    const report = leaks.map((l) => `  ${l.file}:${l.line}  import('${l.specifier}')`).join('\n')
    expect(
      leaks,
      `Server-only imports outside .handler() in server-function modules — these ship to the browser.\n` +
        `Move the helper into lib/server/domains and import it from inside the handler.\n${report}`
    ).toEqual([])
  })
})
