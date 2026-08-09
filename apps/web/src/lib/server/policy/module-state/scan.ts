/**
 * Module-scope mutable state scanner (SAAS-HOSTING-STACK.md §4.4).
 *
 * Module-scope mutable state is what survives a request. In a pooled process
 * that also means it survives a *tenant*, so every such site is either
 * tenant-keyed, holds nothing tenant-derived, or is a cross-tenant capability
 * nobody wrote down. §4.4's whole argument is that fixing the twenty known
 * sites is worth much less than stopping the twenty-first: "without it,
 * singleton twenty-one lands three weeks after twenty is fixed."
 *
 * ## Why the TypeScript AST and not a regex
 *
 * Piece 5's `Vary: Host` guard and Piece 3's migration linter were both
 * attacked through their tokenizers — braces inside strings, comments eating
 * line content, template literals. `dep-graph/scan.ts` already made the right
 * call for exactly this reason ("cannot be fooled by import-shaped text in
 * comments or strings"), and this follows it. A parser does not have a
 * tokenizer gap: a `let` inside a string is a string, a `{` inside a template
 * literal is a character, and a commented-out declaration is trivia. None of
 * those classes of bypass exist here, rather than being defended against.
 *
 * ## What counts as a site
 *
 * Five shapes, because a rule that only knows about top-level `let` is
 * trivially routed around:
 *
 * | kind | shape |
 * | --- | --- |
 * | `binding` | module-scope `let` / `var` |
 * | `container` | module-scope `const` bound to a mutable container **that is actually mutated** |
 * | `factory` | module-scope `const` bound to a call of a local function that closes over mutable state |
 * | `class-static` | a mutable `static` field on a module-scope class |
 * | `global-assign` | assignment to `globalThis.x` / `global.x` anywhere in the file |
 *
 * ## Why frozen constants are not reported at all
 *
 * §4 counts "about 45 other module-scope `Set`/`Map` instances [that] are
 * frozen constants and are safe". They are not state — they are a lookup table
 * spelled with `new Set`. Reporting them would mean 45 ledger lines that say
 * nothing, and a ledger nobody reads is a ledger that gets a real entry
 * appended to it unnoticed.
 *
 * So a container is a *site* only if something mutates it. The scanner decides
 * that itself rather than believing a label: `.set(`/`.add(`/`.push(`/
 * `delete x.y`/`x.y = `/`x.y++` against the binding, searched in the declaring
 * file — and repo-wide for an exported binding, because `export const registry
 * = new Map()` mutated from three other files is state no matter where the
 * `.set()` lives.
 *
 * The safety direction is right too: the failure mode of the mutation search
 * is a *false* site, which costs one ledger line, not a missed one.
 */
import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { walkSourceFiles } from '../source-files'

export type SiteKind = 'binding' | 'container' | 'factory' | 'class-static' | 'global-assign'

export interface StateSite {
  /** Path relative to the repo root, posix-normalized. */
  file: string
  /** The declared name. For `global-assign`, the assigned global property. */
  name: string
  kind: SiteKind
  /** 1-based line of the declaration, for the failure message only. */
  line: number
  /** Whether the binding is exported (so mutation can arrive from elsewhere). */
  exported: boolean
  /**
   * Initializer shape, when the scanner can name it. `TenantKeyedCache` here is
   * what lets the `tenant-keyed` classification be *verified* rather than
   * trusted — a raw `new Map()` cannot be labelled tenant-keyed.
   */
  initializer: string | null
}

/** Containers whose construction alone implies "this holds mutable entries". */
const CONTAINER_CONSTRUCTORS = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'TenantKeyedCache',
])

/** Property names whose invocation mutates the receiver. */
const MUTATING_METHODS = new Set([
  'set',
  'add',
  'delete',
  'clear',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'memo',
  'clearTenant',
])

/**
 * Every assignment operator, enumerated rather than range-checked.
 *
 * `ts.isAssignmentOperatorToken` is not part of the public API surface, and a
 * `FirstAssignment..LastAssignment` range silently changes meaning whenever the
 * compiler renumbers its enum — which is exactly the kind of quiet drift a
 * source-scanning invariant must not inherit. `__tests__/scan.test.ts` asserts
 * each of these is detected.
 */
const ASSIGNMENT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

function isAssignment(token: ts.BinaryOperatorToken): boolean {
  return ASSIGNMENT_OPERATORS.has(token.kind)
}

function posix(p: string): string {
  return p.split(sep).join('/')
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return (mods ?? []).some((m) => m.kind === kind)
}

/**
 * A `declare` binding has no runtime existence — it is a type-space assertion
 * that something else provides the value. `.d.ts` files are the same thing at
 * file granularity. Neither can hold state, and flagging them would train
 * readers to ignore the scanner.
 */
function isAmbient(node: ts.Node, fileName: string): boolean {
  return fileName.endsWith('.d.ts') || hasModifier(node, ts.SyntaxKind.DeclareKeyword)
}

/** Every identifier bound by a (possibly destructuring) binding name. */
function boundNames(name: ts.BindingName, acc: string[] = []): string[] {
  if (ts.isIdentifier(name)) {
    acc.push(name.text)
    return acc
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) boundNames(element.name, acc)
  }
  return acc
}

function initializerLabel(init: ts.Expression | undefined): string | null {
  if (!init) return null
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) return init.expression.text
  if (ts.isArrayLiteralExpression(init)) return '[]'
  if (ts.isObjectLiteralExpression(init)) return '{}'
  if (ts.isCallExpression(init)) {
    if (ts.isIdentifier(init.expression)) return `${init.expression.text}()`
    return 'call()'
  }
  if (ts.isParenthesizedExpression(init)) return initializerLabel(init.expression)
  return null
}

function isContainerInitializer(init: ts.Expression | undefined): boolean {
  if (!init) return false
  if (ts.isParenthesizedExpression(init)) return isContainerInitializer(init.expression)
  if (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init)) {
    return isContainerInitializer(init.expression)
  }
  if (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init)) return true
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
    return CONTAINER_CONSTRUCTORS.has(init.expression.text)
  }
  return false
}

/** Unwrap `as const`, parens and type assertions to the underlying expression. */
function unwrap(node: ts.Expression): ts.Expression {
  let cur: ts.Expression = node
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression
    else if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression
    else if (ts.isSatisfiesExpression(cur)) cur = cur.expression
    else return cur
  }
}

/**
 * Does anything in `root` mutate the binding `name`?
 *
 * Deliberately over-approximate on the name: a same-named local in another
 * function counts. That direction is safe (a spurious ledger line), and the
 * alternative — resolving symbols — needs a full type-checker pass over the
 * tree on every CI run.
 */
export function mutatesBinding(root: ts.Node, name: string): boolean {
  return mutatesTarget(root, (e) => {
    const u = unwrap(e)
    return ts.isIdentifier(u) && u.text === name
  })
}

/**
 * Mutation of `Class.field` (or a bare `field` inside the class body).
 *
 * A static field is written through the class name, so the receiver of the
 * mutating call is itself a property access — `Registry.entries.set(…)` — and
 * an identifier-only matcher never sees it. A rule that only knows `let` and a
 * matcher that only knows identifiers fail the same way: the state is right
 * there and the scanner reports nothing.
 */
export function mutatesStaticMember(root: ts.Node, className: string, field: string): boolean {
  return mutatesTarget(root, (e) => {
    const u = unwrap(e)
    if (ts.isIdentifier(u)) return u.text === field
    if (!ts.isPropertyAccessExpression(u) || u.name.text !== field) return false
    const owner = unwrap(u.expression)
    return (
      (ts.isIdentifier(owner) && owner.text === className) ||
      owner.kind === ts.SyntaxKind.ThisKeyword
    )
  })
}

function mutatesTarget(root: ts.Node, isTarget: (e: ts.Expression) => boolean): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    // x.set(…) / x.push(…) / x.delete(…)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATING_METHODS.has(node.expression.name.text) &&
      isTarget(node.expression.expression)
    ) {
      found = true
      return
    }
    // x.y = … / x[k] = … / x.y += …
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken)) {
      const lhs = unwrap(node.left)
      if (
        (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) &&
        isTarget(lhs.expression)
      ) {
        found = true
        return
      }
    }
    // x.y++ / --x.y
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const op = node.operator
      if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        const operand = unwrap(node.operand)
        if (
          (ts.isPropertyAccessExpression(operand) || ts.isElementAccessExpression(operand)) &&
          isTarget(operand.expression)
        ) {
          found = true
          return
        }
      }
    }
    // delete x.y
    if (ts.isDeleteExpression(node)) {
      const operand = unwrap(node.expression)
      if (
        (ts.isPropertyAccessExpression(operand) || ts.isElementAccessExpression(operand)) &&
        isTarget(operand.expression)
      ) {
        found = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

/** Local names a file introduces through `import` — the only names it can mutate. */
function importedNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
    const clause = stmt.importClause
    if (clause.name) out.add(clause.name.text)
    const bindings = clause.namedBindings
    if (!bindings) continue
    if (ts.isNamespaceImport(bindings)) out.add(bindings.name.text)
    else for (const el of bindings.elements) out.add(el.name.text)
  }
  return out
}

/**
 * Can a value returned by this function carry the closure's state out?
 *
 * A factory returning a string or a plain data object has, by the time it
 * returns, thrown its locals away — `findAppDir()` walks up the tree with a
 * `let dir` and hands back a path. Treating that as a shared singleton would
 * bury the four real instances of the shape under noise, and a scanner people
 * skim is a scanner that misses the fifth.
 *
 * A function, or an object with a function-valued member, is different: the
 * `let` is still reachable through it. That is the whole `createStreamLimiter()`
 * / `makeStash()` shape.
 */
function returnsStateCarrier(fn: ts.Node): boolean {
  const carrier = (expr: ts.Expression, depth = 0): boolean => {
    const e = unwrap(expr)
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true
    if (ts.isNewExpression(e)) return true
    if (ts.isObjectLiteralExpression(e)) {
      return e.properties.some((p) => {
        if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p)) return true
        if (ts.isSetAccessorDeclaration(p)) return true
        if (ts.isPropertyAssignment(p)) return carrier(p.initializer, depth + 1)
        if (ts.isShorthandPropertyAssignment(p) && depth < 2) {
          return localBindingIsCarrier(fn, p.name.text, depth + 1)
        }
        return false
      })
    }
    if (ts.isIdentifier(e) && depth < 2) return localBindingIsCarrier(fn, e.text, depth + 1)
    return false
  }
  const localBindingIsCarrier = (scope: ts.Node, name: string, depth: number): boolean => {
    let hit = false
    const visit = (node: ts.Node): void => {
      if (hit) return
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        if (carrier(node.initializer, depth)) hit = true
        return
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(scope, visit)
    return hit
  }

  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    // A nested function's `return` belongs to that function, not to `fn`.
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node))) return
    if (ts.isArrowFunction(node) && node !== fn) return
    if (ts.isReturnStatement(node) && node.expression && carrier(node.expression)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  // A concise arrow body (`() => ({ ... })`) has no return statement.
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) return carrier(fn.body)
  visit(fn)
  return found
}

/** Does this function body declare mutable state a returned closure could hold? */
function bodyHoldsMutableState(fn: ts.Node): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isVariableStatement(node)) {
      const flags = node.declarationList.flags
      if (!(flags & ts.NodeFlags.Const)) {
        found = true
        return
      }
      for (const d of node.declarationList.declarations) {
        if (isContainerInitializer(d.initializer)) {
          const names = boundNames(d.name)
          if (names.some((n) => mutatesBinding(fn, n))) {
            found = true
            return
          }
        }
      }
    }
    // Do not descend into nested function declarations' *own* locals? We do:
    // a factory that builds its state in a helper it calls is the same shape.
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn, visit)
  return found
}

/** Local function/arrow declarations in a file, by name. */
function localFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      out.set(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!d.initializer || !ts.isIdentifier(d.name)) continue
        const init = unwrap(d.initializer)
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) out.set(d.name.text, init)
      }
    }
  }
  return out
}

/**
 * Top-level statements, treating a `namespace`/`module` block's body as top
 * level too — `namespace N { export let x }` is module-scope state wearing a
 * hat.
 *
 * An **ambient** module is not descended into. `declare global { var __db }` is
 * the shape `db.ts` uses to type a global it assigns elsewhere: the `var` has
 * no `declare` modifier of its own, so ambience has to be inherited from the
 * enclosing block or the type declaration gets reported as the state it merely
 * describes. The assignment itself is still caught, by the `global-assign` rule.
 */
function topLevelStatements(sf: ts.SourceFile): ts.Statement[] {
  const out: ts.Statement[] = []
  const push = (statements: readonly ts.Statement[]): void => {
    for (const s of statements) {
      out.push(s)
      if (!ts.isModuleDeclaration(s) || !s.body || !ts.isModuleBlock(s.body)) continue
      if (hasModifier(s, ts.SyntaxKind.DeclareKeyword)) continue
      if (s.flags & ts.NodeFlags.GlobalAugmentation) continue
      push(s.body.statements)
    }
  }
  push(sf.statements)
  return out
}

/**
 * Extract every module-scope mutable-state site from one file's text.
 *
 * `mutatedElsewhere` answers "does any OTHER file write to this exported
 * binding?". The default answer is no, which is the right reading of a single
 * file on its own: an exported container nothing in its own module writes to is
 * a lookup table until some importer proves otherwise. `scanRoots` supplies the
 * real predicate, so `export const registry = new Map()` mutated from three
 * other files is still reported.
 */
export function extractSites(
  relPath: string,
  text: string,
  mutatedElsewhere: (name: string) => boolean = () => false
): StateSite[] {
  const sf = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const sites: StateSite[] = []
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const locals = localFunctions(sf)

  for (const stmt of topLevelStatements(sf)) {
    if (isAmbient(stmt, relPath)) continue
    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword)

    if (ts.isVariableStatement(stmt)) {
      const isConst = Boolean(stmt.declarationList.flags & ts.NodeFlags.Const)
      for (const d of stmt.declarationList.declarations) {
        const names = boundNames(d.name)
        if (!isConst) {
          for (const name of names) {
            sites.push({
              file: relPath,
              name,
              kind: 'binding',
              line: lineOf(d),
              exported,
              initializer: initializerLabel(d.initializer),
            })
          }
          continue
        }
        if (isContainerInitializer(d.initializer)) {
          for (const name of names) {
            // A container nothing writes to is a constant, not state — that is
            // the ~45 §4 counts as safe. The scanner decides this from the
            // source rather than from a label, so mislabelling cannot hide a
            // write, and adding one turns the constant into a ledgered site.
            if (!mutatesBinding(sf, name) && !(exported && mutatedElsewhere(name))) continue
            sites.push({
              file: relPath,
              name,
              kind: 'container',
              line: lineOf(d),
              exported,
              initializer: initializerLabel(d.initializer),
            })
          }
          continue
        }
        // `const x = makeThing()` where makeThing closes over mutable state.
        const init = d.initializer ? unwrap(d.initializer) : undefined
        if (init && ts.isCallExpression(init)) {
          const callee = unwrap(init.expression)
          let target: ts.Node | undefined
          if (ts.isIdentifier(callee)) target = locals.get(callee.text)
          else if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) target = callee
          if (target && bodyHoldsMutableState(target) && returnsStateCarrier(target)) {
            for (const name of names) {
              sites.push({
                file: relPath,
                name,
                kind: 'factory',
                line: lineOf(d),
                exported,
                initializer: initializerLabel(d.initializer),
              })
            }
          }
        }
      }
      continue
    }

    if (ts.isClassDeclaration(stmt)) {
      const className = stmt.name?.text ?? '(anonymous)'
      for (const member of stmt.members) {
        if (!ts.isPropertyDeclaration(member)) continue
        if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) continue
        if (!ts.isIdentifier(member.name)) continue
        const field = member.name.text
        // Same rule as a module-scope container: written somewhere, or it is a
        // frozen lookup table that happens to hang off a class. `readonly`
        // alone is not enough — `static readonly KNOWN = new Set()` can still
        // be `.add`ed to, because `readonly` binds the reference, not the Set.
        if (!mutatesStaticMember(sf, className, field)) continue
        sites.push({
          file: relPath,
          name: `${className}.${field}`,
          kind: 'class-static',
          line: lineOf(member),
          exported,
          initializer: initializerLabel(member.initializer),
        })
      }
      continue
    }
  }

  // Assignments to a global, wherever they appear: `globalThis.__db = …` is
  // module-scope state that no declaration in this file mentions.
  const visitGlobals = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken)) {
      const lhs = unwrap(node.left)
      if (ts.isPropertyAccessExpression(lhs)) {
        const obj = unwrap(lhs.expression)
        if (ts.isIdentifier(obj) && (obj.text === 'globalThis' || obj.text === 'global')) {
          sites.push({
            file: relPath,
            name: `${obj.text}.${lhs.name.text}`,
            kind: 'global-assign',
            line: lineOf(lhs),
            exported: false,
            initializer: null,
          })
        }
      }
    }
    ts.forEachChild(node, visitGlobals)
  }
  visitGlobals(sf)

  // Dedupe repeated writes to the same global.
  const seen = new Set<string>()
  return sites.filter((s) => {
    const k = `${s.file}|${s.name}|${s.kind}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export interface ScanRoot {
  /** Absolute directory to walk. */
  dir: string
  /** Repo-root-relative prefix used in reported paths. */
  label: string
}

/**
 * Scan every root and drop `container` sites nothing mutates.
 *
 * The mutation search runs over the declaring file for a module-private
 * binding, and over every scanned file for an exported one. That asymmetry is
 * the point: `export const registry = new Map()` is only a constant if nobody,
 * anywhere, writes to it.
 */
export function scanRoots(repoRoot: string, roots: ScanRoot[]): StateSite[] {
  const files: { rel: string; text: string }[] = []
  for (const root of roots) {
    for (const abs of walkSourceFiles(root.dir)) {
      files.push({ rel: posix(relative(repoRoot, abs)), text: readFileSync(abs, 'utf8') })
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel))

  const parsed = files.map((f) => {
    const sf = ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    return { ...f, sf, imported: importedNames(sf) }
  })

  /**
   * Only a file that *imported* the name can be mutating this binding. Without
   * that restriction any unrelated local of the same name counts — `auth`,
   * `registry`, `cache` are not distinctive identifiers — and the ledger fills
   * with entries whose stated reason would be wrong.
   */
  const mutatedByAnImporter = (name: string): boolean =>
    parsed.some((p) => p.imported.has(name) && mutatesBinding(p.sf, name))

  const all: StateSite[] = []
  for (const f of files) all.push(...extractSites(f.rel, f.text, mutatedByAnImporter))

  return all.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
}

/** Stable identity for ledger matching. A line number must never be part of it. */
export function siteId(site: Pick<StateSite, 'file' | 'name'>): string {
  return `${site.file}#${site.name}`
}
