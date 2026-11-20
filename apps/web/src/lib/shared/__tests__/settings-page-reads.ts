/**
 * Reads, from the source, what each admin settings route's loader needs from
 * the server: the gate the route asserts, the reads that must succeed for the
 * page to render, and the permission each of those reads' server functions
 * enforces. settings-page-access.test.ts compares the two.
 *
 * A read must succeed when the loader awaits it unconditionally:
 * `ensure(query)` (a readBatch), `queryClient.ensureQueryData(query)` /
 * `fetchQuery(query)`, or a direct server function call. A read is optional,
 * and skipped, when it is warmed (`warmQuery`), caught (`.catch`), or sits
 * behind a condition (`a ? b : c`, `a && b`, `if`), which is how a loader reads
 * something only for a viewer who holds its permission.
 *
 * The server function's permission comes from the authorization-matrix
 * scanner, the same reading MATRIX.md is built from, so a gate changed on
 * either side shows up here.
 */
import * as ts from '@typescript/typescript6'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { scanAuthzSurfaces, type ScannedGate } from '@/lib/server/policy/authz-matrix/scan'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { AI_ANY_PERMISSIONS } from '@/lib/shared/ai-permissions'
import {
  SUPPORT_SENDER_PERMISSIONS,
  EMAIL_SENDING_PERMISSION,
  SURFACE_SENDER_READ_PERMISSIONS,
} from '@/lib/shared/email-sending-permissions'
import {
  GITHUB_CHANNEL_STATUS_READ_PERMISSIONS,
  PORTAL_PAGE_CONFIG_READ_PERMISSIONS,
} from '@/lib/shared/settings-read-permissions'
import { portalTabPermissions, type PortalTab } from '@/lib/shared/portal-settings-tabs'
import { authTabPermissions, type AuthTab } from '@/lib/shared/authentication-tabs'

export const SRC = resolve(__dirname, '../../..')

/** Permission lists a server function may pass to `assertAnyPermission`. */
const KNOWN_PERMISSION_LISTS: Record<string, readonly PermissionKey[]> = {
  AI_ANY_PERMISSIONS,
  SUPPORT_SENDER_PERMISSIONS,
  GITHUB_CHANNEL_STATUS_READ_PERMISSIONS,
  PORTAL_PAGE_CONFIG_READ_PERMISSIONS,
}
const KNOWN_PERMISSIONS: Record<string, PermissionKey> = { EMAIL_SENDING_PERMISSION }
/** Lists keyed by the request (`RECORD[data.x]`): any list's permission may pass. */
const KNOWN_PERMISSION_RECORDS: Record<string, Record<string, readonly PermissionKey[]>> = {
  SURFACE_SENDER_READ_PERMISSIONS,
}

export interface ServerRead {
  /** The server function, e.g. `fetchPortalConfig`. */
  fn: string
  /** Its file, relative to src. */
  file: string
  /**
   * The permissions any one of which passes its gate; null when it has no
   * permission gate (any signed-in teammate, or public).
   */
  needs: readonly PermissionKey[] | null
  /** Whether the page cannot load without it, ignores its failure, or makes it conditionally. */
  kind: ReadKind
  /** For a guarded read, the permissions its condition checks. */
  guard: PermissionKey[]
}

export interface RouteReads {
  /** The route file, relative to src. */
  file: string
  /** The page path, e.g. `/admin/settings/channels/github`. */
  path: string
  /** The page path passed to assertSettingsPageAccess, or null when none is. */
  gatePath: string | null
  /** Other route-permission asserts still in the file (should be none). */
  otherAsserts: string[]
  /** The reads the loader must have to render the page. */
  reads: ServerRead[]
  /** Read expressions this reader could not follow to a server function. */
  unresolved: string[]
}

const sourceCache = new Map<string, ts.SourceFile>()

function source(abs: string): ts.SourceFile {
  let sf = sourceCache.get(abs)
  if (!sf) {
    sf = ts.createSourceFile(
      abs,
      readFileSync(abs, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    sourceCache.set(abs, sf)
  }
  return sf
}

function resolveModule(fromAbs: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromAbs), spec)
  else return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate)
        return candidate
      } catch {
        // a directory
      }
    }
  }
  return null
}

interface Binding {
  module: string
  name: string
}

/** Names a file brings in: static named imports and `const { a } = await import('m')`. */
function importsOf(abs: string): Map<string, Binding> {
  const sf = source(abs)
  const out = new Map<string, Binding>()
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const module = resolveModule(abs, node.moduleSpecifier.text)
      if (module) {
        for (const el of node.importClause.namedBindings.elements) {
          out.set(el.name.text, { module, name: (el.propertyName ?? el.name).text })
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const init = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (
        ts.isCallExpression(init) &&
        init.expression.kind === ts.SyntaxKind.ImportKeyword &&
        init.arguments[0] &&
        ts.isStringLiteral(init.arguments[0])
      ) {
        const module = resolveModule(abs, init.arguments[0].text)
        if (module) {
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue
            const imported =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : el.name.text
            out.set(el.name.text, { module, name: imported })
          }
        }
      }
    }
    // `const [{ a: b }, { c }] = await Promise.all([import('x'), import('y')])`
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer) {
      const init = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      const list =
        ts.isCallExpression(init) &&
        init.arguments[0] &&
        ts.isArrayLiteralExpression(init.arguments[0])
          ? init.arguments[0].elements
          : undefined
      node.name.elements.forEach((element, index) => {
        const importCall = list?.[index]
        if (
          !ts.isBindingElement(element) ||
          !ts.isObjectBindingPattern(element.name) ||
          !importCall ||
          !ts.isCallExpression(importCall) ||
          importCall.expression.kind !== ts.SyntaxKind.ImportKeyword ||
          !ts.isStringLiteral(importCall.arguments[0])
        ) {
          return
        }
        const module = resolveModule(abs, (importCall.arguments[0] as ts.StringLiteral).text)
        if (!module) return
        for (const el of element.name.elements) {
          if (!ts.isIdentifier(el.name)) continue
          const imported =
            el.propertyName && ts.isIdentifier(el.propertyName)
              ? el.propertyName.text
              : el.name.text
          out.set(el.name.text, { module, name: imported })
        }
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** A top-level declaration of `name` in `abs`, following imports and re-exports. */
function findDeclaration(
  abs: string,
  name: string,
  depth = 0
): { node: ts.Node; file: string } | null {
  if (depth > 6) return null
  const sf = source(abs)
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          return { node: decl.initializer, file: abs }
        }
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && stmt.body) {
      return { node: stmt.body, file: abs }
    }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const module = resolveModule(abs, stmt.moduleSpecifier.text)
      if (!module) continue
      if (!stmt.exportClause) {
        const found = findDeclaration(module, name, depth + 1)
        if (found) return found
      } else if (ts.isNamedExports(stmt.exportClause)) {
        const el = stmt.exportClause.elements.find((e) => e.name.text === name)
        if (el) return findDeclaration(module, (el.propertyName ?? el.name).text, depth + 1)
      }
    }
  }
  const imported = importsOf(abs).get(name)
  if (imported) return findDeclaration(imported.module, imported.name, depth + 1)
  return null
}

const isServerFnModule = (abs: string) => {
  const rel = relative(SRC, abs)
  return rel.startsWith('lib/server/functions/') || /^integrations\/[^/]+\/server\//.test(rel)
}

/** Whether `call` is caught: `call.catch(...)`. */
function isCaught(call: ts.Node): boolean {
  const parent = call.parent
  return (
    !!parent &&
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === call &&
    parent.name.text === 'catch'
  )
}

/** Server functions a query's `queryFn` calls or names, uncaught. */
function serverFnsOfQuery(node: ts.Node, file: string): { fn: string; file: string }[] | null {
  let queryFn: ts.Node | undefined
  const find = (n: ts.Node) => {
    if (queryFn) return
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'queryFn') {
      queryFn = n.initializer
      return
    }
    ts.forEachChild(n, find)
  }
  find(node)
  if (!queryFn) return null
  const imports = importsOf(file)
  const fns: { fn: string; file: string }[] = []
  const seen = new Set<string>()
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const binding = imports.get(n.text)
      if (binding && isServerFnModule(binding.module) && !seen.has(n.text)) {
        const call = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n
        if (!(call && isCaught(n.parent))) {
          seen.add(n.text)
          fns.push({ fn: binding.name, file: relative(SRC, binding.module) })
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(queryFn)
  return fns
}

/** The node a query expression names: `q.prop(...)`, `makeQuery(...)` or `query`. */
function queryNode(expr: ts.Expression, file: string): { node: ts.Node; file: string } | null {
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const owner = findDeclaration(file, callee.expression.text)
      if (!owner) return null
      let prop: ts.Node | undefined
      const find = (n: ts.Node) => {
        if (prop) return
        if (
          (ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) &&
          ts.isIdentifier(n.name) &&
          n.name.text === callee.name.text
        ) {
          prop = n
          return
        }
        ts.forEachChild(n, find)
      }
      find(owner.node)
      return prop ? { node: prop, file: owner.file } : null
    }
    if (ts.isIdentifier(callee)) return findDeclaration(file, callee.text)
    return null
  }
  if (ts.isIdentifier(expr)) return findDeclaration(file, expr.text)
  return null
}

/**
 * How a loader makes a read: one the page cannot load without (`essential`),
 * one whose failure the loader ignores (`warm`: warmed or caught), or one made
 * only behind a condition (`guarded`), with the permissions that condition
 * checks.
 */
export type ReadKind = 'essential' | 'warm' | 'guarded'

/** Helpers whose result lists what a viewer may open: `tabs.includes('x')` checks tab x's permissions. */
const TAB_HELPERS: Record<string, (tab: string) => readonly PermissionKey[]> = {
  portalTabsFor: (tab) => portalTabPermissions(tab as PortalTab),
  authTabsFor: (tab) => authTabPermissions(tab as AuthTab),
}

/** A local `const name = …` in `scope`, or a top-level one in its file. */
function localInitializer(name: string, scope: ts.Node): ts.Node | undefined {
  let found: ts.Node | undefined
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n.initializer
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(scope)
  if (found) return found
  const top = findDeclaration(scope.getSourceFile().fileName, name)
  return top && top.file === scope.getSourceFile().fileName ? top.node : undefined
}

/** The value a top-level function returns, for `fn(...).prop` conditions. */
function returnedObject(fnName: string, sf: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const decl = findDeclaration(sf.fileName, fnName)
  if (!decl) return undefined
  let found: ts.ObjectLiteralExpression | undefined
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
      found = n.expression
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(decl.node)
  return found
}

/**
 * The permissions a condition checks: `PERMISSIONS.X` in it, in the local
 * values it reads (`const canX = permissions.includes(PERMISSIONS.X)`), in a
 * property of an object a local function builds (`tabs.webhooks`), or a tab
 * of a tab helper (`tabs.includes('design')`).
 */
function permissionsIn(node: ts.Node, scope: ts.Node, depth = 0): PermissionKey[] {
  if (depth > 4) return []
  const found: PermissionKey[] = []
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === 'PERMISSIONS') {
        found.push(PERMISSIONS[n.name.text as keyof typeof PERMISSIONS])
        return
      }
      const init = localInitializer(n.expression.text, scope)
      if (
        init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        n.name.text !== 'includes'
      ) {
        const object = returnedObject(init.expression.text, scope.getSourceFile())
        const prop = object?.properties.find(
          (p) => p.name && ts.isIdentifier(p.name) && p.name.text === n.name.text
        )
        if (prop && ts.isPropertyAssignment(prop)) {
          found.push(...permissionsIn(prop.initializer, scope, depth + 1))
          return
        }
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'includes' &&
      ts.isIdentifier(n.expression.expression) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const init = localInitializer(n.expression.expression.text, scope)
      const helper =
        init && ts.isCallExpression(init) && ts.isIdentifier(init.expression)
          ? TAB_HELPERS[init.expression.text]
          : undefined
      if (helper) {
        found.push(...helper(n.arguments[0].text))
        return
      }
    }
    if (ts.isIdentifier(n) && !(n.parent && ts.isPropertyAccessExpression(n.parent))) {
      const init = localInitializer(n.text, scope)
      if (init && init !== node) found.push(...permissionsIn(init, scope, depth + 1))
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function readKind(node: ts.Node, stop: ts.Node): { kind: ReadKind; guard: PermissionKey[] } {
  let child: ts.Node = node
  let parent = node.parent
  let warm =
    isCaught(node) ||
    (ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'warmQuery')
  const guard: PermissionKey[] = []
  let guarded = false
  while (parent && parent !== stop) {
    let condition: ts.Node | undefined
    if (ts.isConditionalExpression(parent) && child !== parent.condition) {
      condition = parent.condition
    } else if (
      ts.isBinaryExpression(parent) &&
      child === parent.right &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(parent.operatorToken.kind)
    ) {
      condition = parent.left
    } else if (ts.isIfStatement(parent) && child !== parent.expression) {
      condition = parent.expression
    }
    if (condition) {
      guarded = true
      guard.push(...permissionsIn(condition, stop))
    }
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === 'warmQuery'
    ) {
      warm = true
    }
    if (ts.isCallExpression(child) && isCaught(child)) warm = true
    child = parent
    parent = parent.parent
  }
  // A condition that checks no permission (a feature flag, the open tab) is
  // read as a condition on what the page shows, not on who reads it.
  if (guarded && guard.length > 0) return { kind: 'guarded', guard }
  return { kind: warm ? 'warm' : 'essential', guard: [] }
}

const READ_METHODS = new Set(['ensureQueryData', 'fetchQuery'])

function routeOptions(
  sf: ts.SourceFile
): { id: string; options: ts.ObjectLiteralExpression } | null {
  let found: { id: string; options: ts.ObjectLiteralExpression } | null = null
  const visit = (n: ts.Node) => {
    if (found) return
    if (
      ts.isCallExpression(n) &&
      ts.isCallExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'createFileRoute' &&
      ts.isStringLiteral(n.expression.arguments[0]) &&
      n.arguments[0] &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      found = { id: (n.expression.arguments[0] as ts.StringLiteral).text, options: n.arguments[0] }
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

/** `/admin/settings_/workflows/$id` and `/admin/settings/channels_/email` as page paths. */
export function pagePathOfRouteId(id: string): string {
  return id
    .split('/')
    .map((segment) => segment.replace(/_$/, ''))
    .join('/')
    .replace(/\/$/, '')
}

function optionFn(options: ts.ObjectLiteralExpression, name: string): ts.Node | undefined {
  for (const prop of options.properties) {
    if (!prop.name || !ts.isIdentifier(prop.name) || prop.name.text !== name) continue
    if (ts.isPropertyAssignment(prop)) return prop.initializer
    if (ts.isMethodDeclaration(prop)) return prop
  }
  return undefined
}

let gatesBySurface: Map<string, ScannedGate[]> | null = null

function serverGates(): Map<string, ScannedGate[]> {
  if (!gatesBySurface) {
    gatesBySurface = new Map()
    for (const gate of scanAuthzSurfaces(SRC).gates) {
      const key = `${gate.file}::${gate.surface}`
      gatesBySurface.set(key, [...(gatesBySurface.get(key) ?? []), gate])
    }
  }
  return gatesBySurface
}

/** The permissions, any one of which passes a server function's gate. */
export function serverFnNeeds(fn: string, file: string): readonly PermissionKey[] | null {
  const gates = serverGates().get(`${file}::${fn}`) ?? []
  const needs = new Set<PermissionKey>()
  for (const gate of gates) {
    const authz = gate.authz
    if (authz.kind === 'permission') {
      const value = authz.permissionConst
        ? PERMISSIONS[authz.permissionConst as keyof typeof PERMISSIONS]
        : (authz.permissionLiteral as PermissionKey | null)
      if (!value) throw new Error(`${file}::${fn}: unreadable permission gate`)
      needs.add(value)
    } else if (authz.kind === 'unparseable') {
      throw new Error(`${file}::${fn}: unparseable gate ${authz.raw}`)
    }
  }
  // `assertAnyPermission(await requireAuth(), LIST)` / `assertPermission(auth, P)`
  const decl = findDeclaration(join(SRC, file), fn)
  if (decl) {
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        (n.expression.text === 'assertAnyPermission' || n.expression.text === 'assertPermission') &&
        n.arguments[1]
      ) {
        const arg = n.arguments[1]
        if (
          ts.isPropertyAccessExpression(arg) &&
          ts.isIdentifier(arg.expression) &&
          arg.expression.text === 'PERMISSIONS'
        ) {
          needs.add(PERMISSIONS[arg.name.text as keyof typeof PERMISSIONS])
        } else if (ts.isIdentifier(arg) && KNOWN_PERMISSION_LISTS[arg.text]) {
          for (const p of KNOWN_PERMISSION_LISTS[arg.text]) needs.add(p)
        } else if (ts.isIdentifier(arg) && KNOWN_PERMISSIONS[arg.text]) {
          needs.add(KNOWN_PERMISSIONS[arg.text])
        } else if (
          ts.isElementAccessExpression(arg) &&
          ts.isIdentifier(arg.expression) &&
          KNOWN_PERMISSION_RECORDS[arg.expression.text]
        ) {
          for (const list of Object.values(KNOWN_PERMISSION_RECORDS[arg.expression.text])) {
            for (const p of list) needs.add(p)
          }
        } else {
          throw new Error(`${file}::${fn}: unread permission argument ${arg.getText()}`)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(decl.node)
  }
  return needs.size > 0 ? [...needs] : null
}

/** Every admin settings route file, relative to src. */
export function settingsRouteFiles(): string[] {
  const dir = join(SRC, 'routes/admin')
  const files = readdirSync(dir)
    .filter((name) => /^settings[._].*\.tsx$|^settings\.tsx$/.test(name))
    .map((name) => `routes/admin/${name}`)
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(SRC, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(child)
      } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) files.push(child)
    }
  }
  walk('routes/admin/settings')
  return files.sort()
}

export function readRoute(file: string): RouteReads | null {
  const abs = join(SRC, file)
  const sf = source(abs)
  const route = routeOptions(sf)
  if (!route) return null
  const imports = importsOf(abs)
  const result: RouteReads = {
    file,
    path: pagePathOfRouteId(route.id),
    gatePath: null,
    otherAsserts: [],
    reads: [],
    unresolved: [],
  }
  const addRead = (
    fn: string,
    importedFrom: string,
    how: { kind: ReadKind; guard: PermissionKey[] }
  ) => {
    // A module may re-export the function; its gate is where it is declared.
    const declared = findDeclaration(join(SRC, importedFrom), fn)
    const fnFile = declared ? relative(SRC, declared.file) : importedFrom
    const existing = result.reads.find((r) => r.fn === fn && r.file === fnFile)
    if (existing) {
      // Read twice: the strongest reading wins (essential over warm over guarded).
      const rank = { essential: 2, warm: 1, guarded: 0 }
      if (rank[how.kind] > rank[existing.kind]) Object.assign(existing, how)
      return
    }
    result.reads.push({ fn, file: fnFile, needs: serverFnNeeds(fn, fnFile), ...how })
  }
  const addQuery = (arg: ts.Expression | undefined, at: ts.Node, stop: ts.Node) => {
    const query = arg ? queryNode(arg, abs) : null
    const fns = query ? serverFnsOfQuery(query.node, query.file) : null
    if (!fns) result.unresolved.push(at.getText())
    else for (const read of fns) addRead(read.fn, read.file, readKind(at, stop))
  }
  for (const hook of ['beforeLoad', 'loader']) {
    const fn = optionFn(route.options, hook)
    if (!fn) continue
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null
        if (name === 'assertSettingsPageAccess') {
          const arg = n.arguments[1]
          result.gatePath = arg && ts.isStringLiteral(arg) ? arg.text : `<${arg?.getText()}>`
        } else if (name === 'assertRoutePermission' || name === 'assertRouteAnyPermission') {
          result.otherAsserts.push(n.getText())
        } else if (name === 'warmQuery') {
          addQuery(n.arguments[1], n, fn)
        } else if (
          (ts.isIdentifier(callee) && callee.text === 'ensure') ||
          (ts.isPropertyAccessExpression(callee) && READ_METHODS.has(callee.name.text))
        ) {
          addQuery(n.arguments[0], n, fn)
        } else if (ts.isIdentifier(callee)) {
          const binding = imports.get(callee.text)
          if (binding && isServerFnModule(binding.module)) {
            addRead(binding.name, relative(SRC, binding.module), readKind(n, fn))
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(fn)
  }
  return result
}
