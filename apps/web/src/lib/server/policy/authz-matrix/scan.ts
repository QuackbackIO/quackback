/**
 * Static authorization-gate scanner.
 *
 * Walks the server source tree and, via the TypeScript AST, enumerates every
 * place a request's authorization is decided:
 *   - `requireAuth(...)`        — server-function gates
 *   - `withApiKeyAuth(...)`     — public REST API gates
 *   - `requireTeamAuth()`       — the moderation-queue wrapper (a gate alias)
 *   - inline `isAdmin(...)` / `isTeamMember(...)` inside function/route files
 *
 * For each gate it records the *enforced* authorization read straight off the
 * source: a catalogue permission (`PERMISSIONS.X`), `bare` (any valid
 * principal), an `alias` (a local gate wrapper), or `unparseable` (a gate whose
 * authority a human can't read statically — these must fail CI).
 *
 * The scanner is the ground truth the authorization matrix is built on: because
 * it reads the real gate rather than a hand-kept list, a widened gate changes
 * the scan output, which changes the derived matrix, which shows up in review.
 *
 * AST-only, no type-checker: parse-and-walk is fast enough to run in a single
 * test and never needs a resolved program.
 */
import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { walkSourceFiles } from '../source-files'

/** Gate call-ees whose argument declares the enforced authorization. */
const GATE_CALLEES = new Set(['requireAuth', 'withApiKeyAuth', 'requireTeamAuth'])
/** Team wrappers with no options arg — authority declared in classifications. */
const ALIAS_CALLEES = new Set(['requireTeamAuth'])
/** Role predicates that, used inside a route/function file, may gate access. */
const INLINE_AUTHZ_CALLEES = new Set(['isAdmin', 'isTeamMember'])
/** Directories (relative to src) whose inline role checks are treated as gates. */
const INLINE_SCAN_DIRS = ['lib/server/functions', 'routes/api']

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

export type ScannedAuthz =
  | { kind: 'permission'; permissionConst: string | null; permissionLiteral: string | null }
  | { kind: 'bare' }
  | { kind: 'alias'; callee: string }
  | { kind: 'unparseable'; raw: string }

export interface ScannedGate {
  /** Path relative to apps/web/src (posix-normalized), e.g. `lib/server/functions/posts.ts`. */
  file: string
  line: number
  /** `requireAuth` | `withApiKeyAuth` | `requireTeamAuth`. */
  callee: string
  /** Nearest enclosing named declaration or HTTP method — the reviewable surface label. */
  surface: string
  authz: ScannedAuthz
}

export interface ScannedInline {
  file: string
  line: number
  callee: string
  surface: string
}

export interface ScanResult {
  gates: ScannedGate[]
  inline: ScannedInline[]
}

/** MCP gate helpers that fold a scope + team requirement into one call. */
const MCP_SCOPE_HELPERS: Record<string, { scope: string; teamOnly: boolean }> = {
  requireHelpCenterWrite: { scope: 'write:article', teamOnly: true },
}

export interface ScannedMcpTool {
  name: string
  /** Scopes the tool's handler asserts via `requireScope` (any branch). */
  scopes: string[]
  /** The handler asserts a team role via `requireTeamRole` (or a helper that does). */
  teamOnly: boolean
}

/** Identifiers whose presence in a file's text means it's worth AST-parsing. */
const SCAN_TOKENS = [...GATE_CALLEES, ...INLINE_AUTHZ_CALLEES]

/** The permission property's initializer, classified. */
function classifyPermissionArg(objArg: ts.Expression): ScannedAuthz {
  if (!ts.isObjectLiteralExpression(objArg)) {
    return { kind: 'unparseable', raw: objArg.getText() }
  }
  const named = (key: string) =>
    objArg.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key
    )
  // A regression to the retired `{ roles }` / `{ role }` gate must fail loudly,
  // not masquerade as a bare gate. (Typecheck already blocks it — the option was
  // deleted — but the scan flags it in case the type ever loosens.)
  if (named('roles') || named('role')) {
    return { kind: 'unparseable', raw: objArg.getText() }
  }
  const prop = named('permission')
  // `requireAuth({})` with no permission is semantically bare (permission is optional).
  if (!prop) return { kind: 'bare' }

  const init = prop.initializer
  // PERMISSIONS.SETTINGS_MANAGE
  if (
    ts.isPropertyAccessExpression(init) &&
    ts.isIdentifier(init.expression) &&
    init.expression.text === 'PERMISSIONS'
  ) {
    return { kind: 'permission', permissionConst: init.name.text, permissionLiteral: null }
  }
  // 'settings.manage'
  if (ts.isStringLiteral(init)) {
    return { kind: 'permission', permissionConst: null, permissionLiteral: init.text }
  }
  return { kind: 'unparseable', raw: init.getText() }
}

function gateAuthz(callee: string, call: ts.CallExpression): ScannedAuthz {
  if (ALIAS_CALLEES.has(callee)) return { kind: 'alias', callee }

  if (callee === 'requireAuth') {
    if (call.arguments.length === 0) return { kind: 'bare' }
    return classifyPermissionArg(call.arguments[0])
  }
  if (callee === 'withApiKeyAuth') {
    // withApiKeyAuth(request) is bare; withApiKeyAuth(request, { permission }) gates.
    if (call.arguments.length <= 1) return { kind: 'bare' }
    return classifyPermissionArg(call.arguments[1])
  }
  return { kind: 'unparseable', raw: call.getText() }
}

/**
 * The reviewable surface label for a gate: the innermost enclosing HTTP-method
 * handler (for API routes) else the module-level declaration that owns the gate
 * (the exported server function). Deliberately skips the local `const auth =
 * await requireAuth()` binding — that inner variable is not the surface, the
 * function that holds it is — so labels stay unique per file and stable across
 * edits above them.
 */
function enclosingSurface(node: ts.Node): string {
  let httpMethod: string | null = null
  let moduleDecl: string | null = null
  let n: ts.Node | undefined = node.parent
  while (n) {
    if (
      !httpMethod &&
      (ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) &&
      ts.isIdentifier(n.name) &&
      HTTP_METHODS.has(n.name.text)
    ) {
      httpMethod = n.name.text
    }
    if (ts.isFunctionDeclaration(n) && n.name && ts.isSourceFile(n.parent)) {
      moduleDecl = n.name.text
    }
    if (ts.isVariableStatement(n) && ts.isSourceFile(n.parent)) {
      const first = n.declarationList.declarations[0]
      if (first && ts.isIdentifier(first.name)) moduleDecl = first.name.text
    }
    n = n.parent
  }
  return httpMethod ?? moduleDecl ?? '(module)'
}

function calleeName(call: ts.CallExpression): string | null {
  return ts.isIdentifier(call.expression) ? call.expression.text : null
}

/**
 * Scan a single source file's text. The pure, deterministic seam — unit-tested
 * against synthetic snippets so the extraction rules are pinned without leaning
 * on the (churning) live tree.
 *
 * @param relPath path relative to apps/web/src, posix-normalized (drives both
 *   the `.tsx` script-kind choice and the inline-scan directory gate)
 */
export function scanSourceFile(relPath: string, text: string): ScanResult {
  const gates: ScannedGate[] = []
  const inline: ScannedInline[] = []
  const sf = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const inInlineScanDir = INLINE_SCAN_DIRS.some((d) => relPath.startsWith(d + '/'))

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (name && GATE_CALLEES.has(name)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        gates.push({
          file: relPath,
          line,
          callee: name,
          surface: enclosingSurface(node),
          authz: gateAuthz(name, node),
        })
      } else if (name && inInlineScanDir && INLINE_AUTHZ_CALLEES.has(name)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        inline.push({ file: relPath, line, callee: name, surface: enclosingSurface(node) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { gates, inline }
}

/**
 * Extract every MCP tool's authorization contract (required scope(s) + team
 * requirement) straight from `server.tool(name, …)` registrations, so the MCP
 * matrix reads the real guards rather than a hand-kept list.
 */
export function scanMcpTools(relPath: string, text: string): ScannedMcpTool[] {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const tools: ScannedMcpTool[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'tool' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const name = node.arguments[0].text
      const scopes = new Set<string>()
      let teamOnly = false

      const inner = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          const callee = n.expression.text
          const scopeArg = n.arguments[1]
          if (callee === 'requireScope' && scopeArg && ts.isStringLiteral(scopeArg)) {
            scopes.add(scopeArg.text)
          } else if (callee === 'requireTeamRole') {
            teamOnly = true
          } else if (MCP_SCOPE_HELPERS[callee]) {
            scopes.add(MCP_SCOPE_HELPERS[callee].scope)
            teamOnly = teamOnly || MCP_SCOPE_HELPERS[callee].teamOnly
          }
        }
        ts.forEachChild(n, inner)
      }
      ts.forEachChild(node, inner)
      tools.push({ name, scopes: [...scopes].sort(), teamOnly })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return tools
}

export interface EntryPoint {
  file: string
  surface: string
  kind: 'server-fn' | 'route'
  /** The entry point's body contains a `requireAuth` / `withApiKeyAuth` / `requireTeamAuth` gate. */
  gated: boolean
}

/** Whether a subtree contains a call to one of the scanned gate callees. */
function subtreeHasGate(node: ts.Node): boolean {
  let found = false
  const check = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      GATE_CALLEES.has(n.expression.text)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, check)
  }
  check(node)
  return found
}

/**
 * Enumerate request entry points — every `createServerFn(...)` declaration and
 * every REST route HTTP-method handler — and whether each contains a scanned
 * gate. The matrix pins the *ungated* set (see MATRIX.md) so a newly added
 * route or function that forgets to gate shows up as a reviewable diff rather
 * than sliding in silently: the permission-gate scan alone can't catch a gate
 * that was never written.
 */
export function scanEntryPoints(relPath: string, text: string): EntryPoint[] {
  const sf = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const moduleFns = collectModuleFunctions(sf)
  const entries: EntryPoint[] = []
  const seenStmts = new Set<ts.Node>()

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createServerFn'
    ) {
      // Climb to the module-level `export const xFn = createServerFn()…` so the
      // whole handler chain (where the gate lives) is the checked subtree.
      let stmt: ts.Node | undefined = node
      while (stmt && !(ts.isVariableStatement(stmt) && ts.isSourceFile(stmt.parent)))
        stmt = stmt.parent
      if (stmt && !seenStmts.has(stmt)) {
        seenStmts.add(stmt)
        entries.push({
          file: relPath,
          surface: enclosingSurface(node),
          kind: 'server-fn',
          gated: subtreeHasGate(stmt),
        })
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      HTTP_METHODS.has(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer) ||
        ts.isIdentifier(node.initializer))
    ) {
      entries.push({
        file: relPath,
        surface: node.name.text,
        kind: 'route',
        gated: routeHandlerHasGate(node.initializer, moduleFns),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return entries
}

/**
 * Gate detection for a route handler in any of its authored shapes: an inline
 * function, an extracted same-file function referenced by identifier, or an
 * inline wrapper delegating to one. Resolution is same-file and one hop only;
 * an identifier that cannot be resolved is treated as UNGATED so the route
 * stays visible in the inventory instead of silently disappearing (the
 * fail-visible rule this scanner exists for).
 */
function routeHandlerHasGate(initializer: ts.Expression, moduleFns: Map<string, ts.Node>): boolean {
  if (ts.isIdentifier(initializer)) {
    const resolved = moduleFns.get(initializer.text)
    return resolved ? subtreeHasGate(resolved) : false
  }
  if (subtreeHasGate(initializer)) return true
  // Delegating wrapper: scan any same-file functions the inline body calls.
  let delegated = false
  const followCalls = (n: ts.Node): void => {
    if (delegated) return
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const target = moduleFns.get(n.expression.text)
      if (target && subtreeHasGate(target)) {
        delegated = true
        return
      }
    }
    ts.forEachChild(n, followCalls)
  }
  followCalls(initializer)
  return delegated
}

/**
 * Index every module-level `function name() {}` / `const name = () => {}` in
 * one pass, so identifier resolution during the entry-point scan is a map
 * lookup instead of a statement re-walk per call site. First declaration
 * wins, matching the sequential resolution it replaces.
 */
function collectModuleFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const fns = new Map<string, ts.Node>()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && !fns.has(stmt.name.text)) {
      fns.set(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          !fns.has(decl.name.text) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          fns.set(decl.name.text, decl.initializer)
        }
      }
    }
  }
  return fns
}

/**
 * Scan the whole server source tree for authorization gates and entry points.
 *
 * @param srcRoot absolute path to apps/web/src
 */
export function scanAuthzSurfaces(srcRoot: string): ScanResult {
  const gates: ScannedGate[] = []
  const inline: ScannedInline[] = []

  for (const absPath of walkSourceFiles(srcRoot)) {
    const rel = relative(srcRoot, absPath).split('\\').join('/')
    const text = readFileSync(absPath, 'utf8')
    // A file that never names any gate identifier cannot contain a gate call —
    // skip the AST parse (roughly 6 in 7 files) rather than parse the whole tree.
    if (!SCAN_TOKENS.some((t) => text.includes(t))) continue
    const perFile = scanSourceFile(rel, text)
    gates.push(...perFile.gates)
    inline.push(...perFile.inline)
  }

  gates.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  inline.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return { gates, inline }
}

/**
 * Enumerate every entry point across the tree. Uses its own filter — an ungated
 * entry point contains no gate token, so the gate scan's pre-filter would skip
 * the very files this needs to find.
 */
export function scanAllEntryPoints(srcRoot: string): EntryPoint[] {
  const entries: EntryPoint[] = []
  for (const absPath of walkSourceFiles(srcRoot)) {
    const text = readFileSync(absPath, 'utf8')
    if (!text.includes('createServerFn') && !text.includes('createFileRoute')) continue
    const rel = relative(srcRoot, absPath).split('\\').join('/')
    entries.push(...scanEntryPoints(rel, text))
  }
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.surface.localeCompare(b.surface))
  return entries
}
