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
import { join, relative, posix } from 'node:path'
import { walkSourceFiles } from '../source-files'
import { isClientProtectedSpecifier } from '../client-import-protection'

const SRC_ROOT = join(__dirname, '../../../..') // apps/web/src
const FUNCTIONS_ROOT = join(SRC_ROOT, 'lib/server/functions')

/** `src/`-relative module path (no extension) of a `@/` or relative specifier; null for bare packages. */
function resolveLocalSpecifier(spec: string, relPath: string): string | null {
  let path: string
  if (spec.startsWith('@/')) path = spec.slice(2)
  else if (spec.startsWith('.')) path = posix.join(posix.dirname(relPath.replace(/\\/g, '/')), spec)
  else return null
  return path.replace(/\.tsx?$/, '')
}

/**
 * Modules that must never be reachable from the client half of a
 * server-function file. `relPath` is the importing file relative to `src/`,
 * so relative specifiers (`'../storage/s3'` from `lib/server/functions/…`)
 * are classified by where they land, not by how they are spelled.
 *
 * Under `lib/server/functions/` only modules that themselves declare server
 * functions are client-safe: they get their own client half (and their own run
 * of this guard). Helper-only siblings such as `auth-helpers.ts` are plain
 * server modules — importing them from the browser drags in `@/lib/server/db`.
 */
export function isServerOnlySpecifier(
  spec: string,
  relPath: string,
  isServerFnModule: (path: string) => boolean
): boolean {
  const path = resolveLocalSpecifier(spec, relPath)
  if (path === null) return isClientProtectedSpecifier(spec)
  if (path.startsWith('lib/server/functions/')) return !isServerFnModule(path)
  // vite.config.ts swaps these for a no-op stub in the client environment
  // (`stubServerLoggerInClient`), so module-scope `logger.child(...)` is fine.
  if (path === 'lib/server/logger' || path === 'lib/server/log-context') return false
  return path.startsWith('lib/server/')
}

const START_PACKAGES = new Set(['@tanstack/react-start', '@tanstack/react-start/server'])

/** Local names bound to each Start builder, so `import { createServerFn as fn }` is seen through. */
interface StartBuilders {
  serverFn: Set<string>
  middleware: Set<string>
  serverOnlyFn: Set<string>
}

function collectStartBuilders(sf: ts.SourceFile): StartBuilders {
  const builders: StartBuilders = {
    serverFn: new Set(),
    middleware: new Set(),
    serverOnlyFn: new Set(),
  }
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    if (!START_PACKAGES.has(stmt.moduleSpecifier.text)) continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text
      if (imported === 'createServerFn') builders.serverFn.add(el.name.text)
      else if (imported === 'createMiddleware') builders.middleware.add(el.name.text)
      else if (imported === 'createServerOnlyFn') builders.serverOnlyFn.add(el.name.text)
    }
  }
  return builders
}

/** The identifier a builder chain like `createServerFn(...).validator(...).handler(...)` starts from. */
function chainRootName(callee: ts.Expression): string | null {
  let cur: ts.Expression = callee
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) cur = cur.expression
    else if (ts.isCallExpression(cur)) cur = cur.expression
    else return ts.isIdentifier(cur) ? cur.text : null
  }
}

/**
 * Calls whose arguments the Start compiler removes from the client half. The
 * whole `createServerFn(...)` chain collapses to `.handler(createClientRpc(id))`
 * — validators and middleware go too, not just the handler — while for
 * `createMiddleware()` only `.server(...)` is stripped (`.client(...)` runs in
 * the browser). `createServerOnlyFn(...)` drops its argument outright.
 */
function isServerStrippedCall(node: ts.CallExpression, builders: StartBuilders): boolean {
  const callee = node.expression
  if (ts.isIdentifier(callee)) return builders.serverOnlyFn.has(callee.text)
  if (!ts.isPropertyAccessExpression(callee)) return false
  const root = chainRootName(callee)
  if (root === null) return false
  if (builders.serverFn.has(root)) return true
  if (builders.middleware.has(root)) return callee.name.text === 'server'
  return false
}

/**
 * Whether the module declares server functions, i.e. gets a client half of RPC
 * stubs that browser code imports. Server-only helper modules that also live
 * under `functions/` (e.g. `origin-transfer.ts`, reached solely through
 * `createServerOnlyFn`) never do, and are out of scope.
 */
export function declaresServerFunctions(sf: ts.SourceFile): boolean {
  const { serverFn } = collectStartBuilders(sf)
  if (serverFn.size === 0) return false
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      serverFn.has(n.expression.text)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

/** Interfaces, type aliases and `declare` blocks are erased; they cannot reach anything. */
function isTypeLevelStatement(stmt: ts.Statement): boolean {
  return (
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isModuleDeclaration(stmt)
  )
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

/**
 * Identifiers mentioned in `node` at runtime, skipping anything the compiler
 * strips from the client half and anything TypeScript erases (type positions).
 */
function identifiersOutsideStrippedScopes(node: ts.Node, builders: StartBuilders): Set<string> {
  const names = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n)) return
    if (ts.isCallExpression(n) && isServerStrippedCall(n, builders)) {
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

interface Analysis {
  sf: ts.SourceFile
  builders: StartBuilders
  isServerOnly: (spec: string) => boolean
}

function serverOnlyDynamicImports(a: Analysis, root: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && isServerStrippedCall(n, a.builders)) return
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      a.isServerOnly(n.arguments[0].text)
    ) {
      found.push(n)
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
  return found
}

export function findLeakedServerImports(
  relPath: string,
  text: string,
  isServerFnModule: (path: string) => boolean = () => false
): LeakedImport[] {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const a: Analysis = {
    sf,
    builders: collectStartBuilders(sf),
    isServerOnly: (spec) => isServerOnlySpecifier(spec, relPath, isServerFnModule),
  }

  const byName = new Map<string, ts.Statement>()
  const roots: ts.Statement[] = []
  const exportedNames = new Set<string>()
  // Static imports of server-only modules, keyed by statement: reachable via
  // any of their runtime bindings, exactly like a helper declaration.
  const serverOnlyStaticImports = new Map<ts.Statement, string>()
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const spec = stmt.moduleSpecifier.text
      if (!a.isServerOnly(spec)) continue
      const clause = stmt.importClause
      // `import type` and side-effect imports leave no runtime binding to reach;
      // a bare `import '@/lib/server/x'` always runs, so it is a root.
      if (!clause) {
        roots.push(stmt)
        serverOnlyStaticImports.set(stmt, spec)
        continue
      }
      if (clause.isTypeOnly) continue
      const bindings: string[] = []
      if (clause.name) bindings.push(clause.name.text)
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          bindings.push(clause.namedBindings.name.text)
        } else {
          for (const el of clause.namedBindings.elements) {
            if (!el.isTypeOnly) bindings.push(el.name.text)
          }
        }
      }
      if (bindings.length === 0) continue
      for (const name of bindings) byName.set(name, stmt)
      serverOnlyStaticImports.set(stmt, spec)
      continue
    }
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        // `export … from '@/lib/server/x'` re-exports the server module itself.
        if (!stmt.isTypeOnly && a.isServerOnly(stmt.moduleSpecifier.text)) {
          roots.push(stmt)
          serverOnlyStaticImports.set(stmt, stmt.moduleSpecifier.text)
        }
        continue
      }
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          exportedNames.add((el.propertyName ?? el.name).text)
        }
      }
      continue
    }
    if (ts.isExportAssignment(stmt)) {
      roots.push(stmt)
      continue
    }
    if (isTypeLevelStatement(stmt)) continue
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
    for (const name of identifiersOutsideStrippedScopes(stmt, a.builders)) {
      const dep = byName.get(name)
      if (dep && !reachable.has(dep)) queue.push(dep)
    }
  }

  const leaks: LeakedImport[] = []
  for (const stmt of sf.statements) {
    if (!reachable.has(stmt)) continue
    const staticSpec = serverOnlyStaticImports.get(stmt)
    if (staticSpec !== undefined) {
      const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf))
      leaks.push({ file: relPath, line: line + 1, specifier: staticSpec })
      continue
    }
    for (const call of serverOnlyDynamicImports(a, stmt)) {
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

const START_IMPORT = `import { createServerFn, createMiddleware, createServerOnlyFn } from '@tanstack/react-start'\n`

/** Samples assume the canonical builder imports; prepend them (one line, so line numbers shift by 1). */
function leaks(file: string, src: string, isServerFnModule?: (path: string) => boolean) {
  return findLeakedServerImports(file, START_IMPORT + src, isServerFnModule)
}

describe('findLeakedServerImports', () => {
  it('recognises builders by their import binding, including aliases', () => {
    const aliased = `
      import { createServerFn as serverFn, createServerOnlyFn as onServer } from '@tanstack/react-start'
      export const fn = serverFn().handler(async () => import('@/lib/server/db'))
      export const only = onServer(async () => import('@/lib/server/auth'))
    `
    expect(findLeakedServerImports('x.ts', aliased)).toEqual([])
    const sf = ts.createSourceFile('x.ts', aliased, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    expect(declaresServerFunctions(sf)).toBe(true)

    // A same-named local function is not the compiler's builder: nothing is stripped.
    const homonym = `
      const createServerFn = () => ({ handler: (f: unknown) => f })
      export const fn = createServerFn().handler(async () => import('@/lib/server/db'))
    `
    expect(findLeakedServerImports('x.ts', homonym)).toHaveLength(1)
    expect(
      declaresServerFunctions(
        ts.createSourceFile('x.ts', homonym, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      )
    ).toBe(false)
  })

  it('flags the bare packages vite.config.ts import-protects', () => {
    const src = `
      import postgres from 'postgres'
      export async function ai() {
        const { default: OpenAI } = await import('openai')
        const { default: pino } = await import('pino/file')
        return [postgres, OpenAI, pino]
      }
    `
    expect(leaks('x.ts', src).map((l) => l.specifier)).toEqual(['postgres', 'openai', 'pino/file'])
  })

  it('only exempts functions/ siblings that declare server functions themselves', () => {
    const file = 'lib/server/functions/posts.ts'
    const src = `
      import { requireAuth } from './auth-helpers'
      import { fetchBoardsFn } from '@/lib/server/functions/boards'
      export const check = () => [requireAuth, fetchBoardsFn]
    `
    const isServerFnModule = (p: string) => p === 'lib/server/functions/boards'
    expect(leaks(file, src, isServerFnModule).map((l) => l.specifier)).toEqual(['./auth-helpers'])
  })

  it('accepts a server import inside .handler()', () => {
    const src = `
      export const fn = createServerFn().handler(async () => {
        const { db } = await import('@/lib/server/db')
        return db
      })
    `
    expect(leaks('x.ts', src)).toEqual([])
  })

  it('accepts server imports inside createMiddleware().server() and createServerOnlyFn()', () => {
    const src = `
      export const mw = createMiddleware().server(async ({ next }) => {
        await import('@/lib/server/auth')
        return next()
      })
      export const only = createServerOnlyFn(async () => import('@/lib/server/db'))
    `
    expect(leaks('x.ts', src)).toEqual([])
  })

  it('treats the whole createServerFn chain as stripped: validators and middleware go too', () => {
    const src = `
      import { ONBOARDING_OUTCOMES } from '@/lib/server/db'
      import { requireAdmin } from '@/lib/server/auth/guards'
      const outcomeSchema = z.enum(ONBOARDING_OUTCOMES)
      export const fn = createServerFn({ method: 'POST' })
        .middleware([requireAdmin])
        .validator(z.object({ outcome: outcomeSchema }))
        .handler(async ({ data }) => data)
    `
    expect(leaks('x.ts', src)).toEqual([])
  })

  it('keeps createMiddleware().client() and ignores type positions', () => {
    const client = `
      import { db } from '@/lib/server/db'
      export const mw = createMiddleware().client(async ({ next }) => { db; return next() })
    `
    expect(leaks('x.ts', client)).toHaveLength(1)

    const typesOnly = `
      import { actorFromAuth } from '@/lib/server/audit/log'
      export interface Input { actor: ReturnType<typeof actorFromAuth> }
      export function shape(x: ReturnType<typeof actorFromAuth>): string { return String(x) }
    `
    expect(leaks('x.ts', typesOnly)).toEqual([])
  })

  it('accepts a helper only handlers reach: the compiler drops it from the client half', () => {
    const src = `
      async function loadCounts() {
        const { db } = await import('@/lib/server/db')
        return db
      }
      export const fn = createServerFn().handler(() => loadCounts())
    `
    expect(leaks('x.ts', src)).toEqual([])
  })

  it('flags an exported helper with a server import', () => {
    const src = `
      export async function assertFits() {
        const { db } = await import('@/lib/server/db')
        return db
      }
    `
    expect(leaks('x.ts', src)).toEqual([{ file: 'x.ts', line: 4, specifier: '@/lib/server/db' }])
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
    expect(leaks('x.ts', src)).toEqual([{ file: 'x.ts', line: 4, specifier: '@/lib/server/db' }])
  })

  it('honours export lists and treats bare top-level statements as roots', () => {
    const listed = `
      async function viaList() { await import('@/lib/server/db') }
      export { viaList }
    `
    expect(leaks('x.ts', listed)).toHaveLength(1)

    const sideEffect = `
      async function warm() { await import('@/lib/server/cache') }
      void warm()
    `
    expect(leaks('x.ts', sideEffect)).toHaveLength(1)
  })

  it('flags a static server import that an export still references', () => {
    const src = `
      import { db } from '@/lib/server/db'
      export async function count() {
        return db.select()
      }
    `
    expect(leaks('x.ts', src)).toEqual([{ file: 'x.ts', line: 3, specifier: '@/lib/server/db' }])
  })

  it('accepts a static server import used only inside handlers, and type-only imports', () => {
    const src = `
      import { db } from '@/lib/server/db'
      import type { Row } from '@/lib/server/db'
      import { type Other, requireAuth } from '@/lib/server/functions/auth-helpers'
      export const fn = createServerFn().handler(async () => db.select())
      export type Out = Row
    `
    expect(leaks('x.ts', src)).toEqual([])
  })

  it('flags namespace/default bindings, side-effect imports and re-exports of server modules', () => {
    const ns = `
      import * as auth from '@/lib/server/auth'
      export const check = () => auth.verify()
    `
    expect(leaks('x.ts', ns)).toHaveLength(1)

    const sideEffect = `import '@/lib/server/db'`
    expect(leaks('x.ts', sideEffect)).toHaveLength(1)

    const reexport = `export { db } from '@/lib/server/db'`
    expect(leaks('x.ts', reexport)).toHaveLength(1)

    const typeReexport = `export type { Database } from '@/lib/server/db'`
    expect(leaks('x.ts', typeReexport)).toEqual([])
  })

  it('classifies relative specifiers by where they resolve', () => {
    const file = 'lib/server/functions/uploads.ts'
    const leaky = `
      import { presign } from '../storage/s3'
      export async function url() {
        await import('../integrations/save')
        return presign()
      }
    `
    expect(leaks(file, leaky).map((l) => l.specifier)).toEqual([
      '../storage/s3',
      '../integrations/save',
    ])

    const fine = `
      import { fetchBoardsFn } from './boards'
      import { schema } from '../../shared/schemas/boards'
      import { logger } from '@/lib/server/logger'
      const log = logger.child({ component: 'uploads' })
      export const check = () => [fetchBoardsFn, schema, log]
    `
    const isServerFnModule = (p: string) => p === 'lib/server/functions/boards'
    expect(leaks(file, fine, isServerFnModule)).toEqual([])
  })

  it('ignores imports of other server-function modules and of shared code', () => {
    const src = `
      export async function helper() {
        await import('@/lib/server/functions/other')
        await import('@/lib/shared/permissions')
      }
    `
    const isServerFnModule = (p: string) => p === 'lib/server/functions/other'
    expect(leaks('x.ts', src, isServerFnModule)).toEqual([])
  })
})

describe('lib/server/functions client half', () => {
  it('never imports server-only modules outside a server-stripped scope', () => {
    const modules = walkSourceFiles(FUNCTIONS_ROOT).map((file) => {
      const relPath = relative(SRC_ROOT, file).replace(/\\/g, '/')
      const text = readFileSync(file, 'utf8')
      const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      return { relPath, text, isServerFnModule: declaresServerFunctions(sf) }
    })
    const serverFnModules = new Set(
      modules.filter((m) => m.isServerFnModule).map((m) => m.relPath.replace(/\.tsx?$/, ''))
    )
    expect(serverFnModules.size).toBeGreaterThan(20)

    const leaks = modules
      .filter((m) => m.isServerFnModule)
      .flatMap((m) => findLeakedServerImports(m.relPath, m.text, (p) => serverFnModules.has(p)))
    const report = leaks.map((l) => `  ${l.file}:${l.line}  import('${l.specifier}')`).join('\n')
    expect(
      leaks,
      `Server-only imports outside .handler() in server-function modules — these ship to the browser.\n` +
        `Move the helper into lib/server/domains and import it from inside the handler.\n${report}`
    ).toEqual([])
  })
})
