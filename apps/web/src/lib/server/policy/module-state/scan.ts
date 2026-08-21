/**
 * Module-scope mutable state scanner (SAAS-HOSTING-STACK.md §4.4).
 *
 * Module-scope mutable state is what survives a request. In a pooled process
 * that also means it survives a *workspace*, so every such site is either
 * workspace-keyed, holds nothing workspace-derived, or is a cross-workspace capability
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
 * frozen constants and are safe". Measured here it is **80** of 97, so the
 * spec undercounts by most of a factor of two — and that only sharpens the
 * point. They are not state; they are a lookup table spelled with `new Set`.
 * Reporting them would mean eighty ledger lines that say nothing, and a ledger
 * nobody reads is a ledger that gets a real entry appended to it unnoticed.
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
import * as ts from '@typescript/typescript6'
import { readFileSync } from 'node:fs'
import { relative, sep, posix as posixPath } from 'node:path'
import { walkSourceFiles } from '../source-files'

export type SiteKind =
  'binding' | 'container' | 'factory' | 'instance' | 'class-static' | 'global-assign'

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
   * Initializer shape, when the scanner can name it. `WorkspaceKeyedCache` here is
   * what lets the `workspace-keyed` classification be *verified* rather than
   * trusted — a raw `new Map()` cannot be labelled workspace-keyed.
   */
  initializer: string | null
}

/** Containers whose construction alone implies "this holds mutable entries". */
const CONTAINER_CONSTRUCTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'WorkspaceKeyedCache'])

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
  'clearWorkspace',
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

/**
 * `Object.*` helpers that mutate their FIRST argument.
 *
 * `Object.assign(state, …)` as a binding's only mutation left it invisible,
 * because nothing about it looks like `state.x = …` or `state.set(…)`.
 */
const OBJECT_MUTATORS: ReadonlySet<string> = new Set([
  'assign',
  'defineProperty',
  'defineProperties',
  'setPrototypeOf',
])

/**
 * `Object.freeze` / `Object.seal` wrappers are transparent to this scanner.
 *
 * Freezing is shallow. `Object.freeze({ tierLimits: new Map() })` is a frozen
 * *reference* around a fully live `Map`, and `CACHES.tierLimits.set(…)` writes
 * to it exactly as a bare `Map` would. Treating the wrapper as evidence of
 * constness is the single most dangerous mistake available here, because the
 * whole reason 80 of 97 containers are suppressed is "nothing writes to it" —
 * and this is the spelling that makes a write look like a constant.
 */
function unwrapObjectWrapper(node: ts.Expression): ts.Expression {
  const e = unwrap(node)
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    ts.isIdentifier(e.expression.expression) &&
    e.expression.expression.text === 'Object' &&
    (e.expression.name.text === 'freeze' || e.expression.name.text === 'seal') &&
    e.arguments.length > 0
  ) {
    return unwrapObjectWrapper(e.arguments[0])
  }
  return e
}

/**
 * The identifier a property chain is rooted at: `a.b.c` → `a`, `a[k].d` → `a`.
 *
 * Matching only the immediate receiver misses every nested container — a `Map`
 * one property deep inside a module-scope object is reached as
 * `CACHES.tierLimits.set(…)`, whose receiver is `CACHES.tierLimits`, not an
 * identifier at all.
 */
function rootIdentifier(node: ts.Expression): string | null {
  let cur: ts.Expression = unwrapObjectWrapper(node)
  for (;;) {
    if (ts.isIdentifier(cur)) return cur.text
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
      cur = unwrapObjectWrapper(cur.expression)
      continue
    }
    return null
  }
}

function posix(p: string): string {
  return p.split(sep).join('/')
}

const posixJoin = (...parts: string[]): string => posixPath.normalize(posixPath.join(...parts))
const posixDirname = (p: string): string => posixPath.dirname(p)

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
  const e = unwrapObjectWrapper(init)
  if (ts.isNewExpression(e)) {
    if (ts.isIdentifier(e.expression)) return `new ${e.expression.text}`
    if (ts.isPropertyAccessExpression(e.expression)) return `new ${e.expression.name.text}`
    return 'new'
  }
  if (ts.isArrayLiteralExpression(e)) return '[]'
  if (ts.isObjectLiteralExpression(e)) return '{}'
  if (ts.isClassExpression(e)) return 'class'
  if (ts.isCallExpression(e)) {
    if (ts.isIdentifier(e.expression)) return `${e.expression.text}()`
    return 'call()'
  }
  return null
}

function isContainerInitializer(init: ts.Expression | undefined): boolean {
  if (!init) return false
  const e = unwrapObjectWrapper(init)
  if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e)) return true
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
    return CONTAINER_CONSTRUCTORS.has(e.expression.text)
  }
  return false
}

/**
 * Constructors whose instances cannot carry state across requests.
 *
 * Deliberately tiny and enumerated. Everything else built with `new` at module
 * scope becomes a ledgered site, because a scanner that only understands
 * `new Map` misses `new Lru()`, `new AsyncLocalStorage()` and `new Proxy()` —
 * and the first of those is the store that carries workspace identity.
 *
 * Each entry here is a value type: immutable after construction, or holding
 * only its own constructor arguments. `Date` is absent on purpose; a
 * module-scope `Date` is a captured boot timestamp, which is exactly the kind
 * of thing worth one ledger line.
 */
const PURE_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'Uint8Array',
  'Uint16Array',
  'Uint32Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
  'ArrayBuffer',
])

/**
 * `new RegExp(...)` is pure only WITHOUT the `g` or `y` flag.
 *
 * A global or sticky regex carries `lastIndex`, which is mutable and persists
 * between calls — so a module-scope one is a shared cursor. Both instances in
 * this tree use `g` and both happen to go through `String.replace`, which
 * resets it, so nothing is exploitable today. But blanket-exempting `RegExp`
 * would silently cover the next `.exec()` loop, which is exactly the kind of
 * "safe by construction" claim this run has repeatedly found to hold only under
 * an unstated precondition.
 */
function isPureRegExp(init: ts.NewExpression): boolean {
  const flags = init.arguments?.[1]
  if (flags === undefined) return true
  const f = unwrap(flags)
  if (!ts.isStringLiteral(f) && !ts.isNoSubstitutionTemplateLiteral(f)) return false
  return !/[gy]/.test(f.text)
}

/**
 * Unwrap parens, `as`, `satisfies` and `await` to the underlying expression.
 *
 * `await` matters because top-level await on an async factory is ordinary
 * modern ESM — `const stash = await makeStash()` is the same site as
 * `const stash = makeStash()`, and without this the whole initializer is an
 * `AwaitExpression` the scanner has no rule for.
 */
function unwrap(node: ts.Expression): ts.Expression {
  let cur: ts.Expression = node
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression
    else if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression
    else if (ts.isSatisfiesExpression(cur)) cur = cur.expression
    else if (ts.isAwaitExpression(cur)) cur = cur.expression
    else return cur
  }
}

/**
 * The expressions a `const` could actually be bound to.
 *
 * A ternary initializer has two of them, and either branch can be the site:
 * `const s = flag ? makeStash() : makeStash()` was invisible because the
 * initializer is a `ConditionalExpression` and every rule looked past it for a
 * call, a `new` or a container.
 */
function initializerBranches(init: ts.Expression): ts.Expression[] {
  const e = unwrapObjectWrapper(init)
  if (ts.isConditionalExpression(e)) {
    return [...initializerBranches(e.whenTrue), ...initializerBranches(e.whenFalse)]
  }
  return [e]
}

/**
 * The function a call actually invokes, seeing through `.call` / `.apply` /
 * `.bind`.
 *
 * `makeStash.call(null)` invokes `makeStash`, but its callee is a property
 * access, so a rule matching identifiers reports nothing. `.bind` is included
 * conservatively: it produces a bound factory rather than a store, which is one
 * `()` away, and there are zero live instances of any of the three so the cost
 * of being wrong in this direction is a ledger line nobody will ever write.
 */
function throughReflectiveCall(callee: ts.Expression): ts.Expression {
  const c = unwrap(callee)
  if (
    ts.isPropertyAccessExpression(c) &&
    (c.name.text === 'call' || c.name.text === 'apply' || c.name.text === 'bind')
  ) {
    return unwrap(c.expression)
  }
  return c
}

/**
 * Does anything in `root` mutate the binding `name`?
 *
 * Deliberately over-approximate on the name: a same-named local in another
 * function counts. That direction is safe (a spurious ledger line), and the
 * alternative — resolving symbols — needs a full type-checker pass over the
 * tree on every CI run.
 */
export function mutatesBinding(
  root: ts.Node,
  name: string,
  aliases: ReadonlySet<string> = new Set()
): boolean {
  const names = new Set([name, ...aliases])
  return mutatesTarget(root, (e) => {
    const rootName = rootIdentifier(e)
    return rootName !== null && names.has(rootName)
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
    // x.set(…) / x.push(…) / x.delete(…), at any property depth:
    // `CACHES.tierLimits.set(…)` writes to a Map one level inside a frozen
    // wrapper, and its receiver is a property access rather than an identifier.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATING_METHODS.has(node.expression.name.text) &&
      isTarget(node.expression.expression)
    ) {
      found = true
      return
    }
    // Object.assign(x, …) / Object.defineProperty(x, …)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Object' &&
      OBJECT_MUTATORS.has(node.expression.name.text) &&
      node.arguments.length > 0 &&
      isTarget(node.arguments[0])
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

/**
 * Exported name -> the local names this file imported it under.
 *
 * `import { registry as reg }` maps `registry -> {registry, reg}`. The exported
 * name is included so a plain import still matches.
 */
function importedLocalNames(sf: ts.SourceFile): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (exported: string, local: string): void => {
    const set = out.get(exported) ?? new Set<string>()
    set.add(exported)
    set.add(local)
    out.set(exported, set)
  }
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
    const bindings = stmt.importClause.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) add((el.propertyName ?? el.name).text, el.name.text)
  }
  return out
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

/**
 * Callable declarations in a file, by name: functions, arrows and classes.
 *
 * Classes are included because `new Lru()` is the same hazard as `makeStash()`
 * wearing different syntax — an instance whose fields hold live containers.
 */
function localCallables(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      out.set(stmt.name.text, stmt)
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      out.set(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!d.initializer || !ts.isIdentifier(d.name)) continue
        const init = unwrap(d.initializer)
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init))
          out.set(d.name.text, init)
      }
    }
  }
  return out
}

/**
 * Does a CLASS hold mutable instance or static state?
 *
 * A field initialised to a container, or any `this.x = …` in the body, means an
 * instance of it is a live store. `new Lru()` at module scope is then module
 * state under a different spelling.
 */
function classHoldsMutableState(node: ts.Node): boolean {
  if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) return false
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && isContainerInitializer(member.initializer)) return true
    if (ts.isPropertyDeclaration(member) && !member.initializer && member.type) {
      // `private entries!: Map<…>` — declared, assigned in the constructor.
      const text = member.type.getText(node.getSourceFile())
      if (/\b(Map|Set|WeakMap|WeakSet|WorkspaceKeyedCache)\b/.test(text)) return true
    }
  }
  let assignsThis = false
  const visit = (n: ts.Node): void => {
    if (assignsThis) return
    if (ts.isBinaryExpression(n) && isAssignment(n.operatorToken)) {
      const lhs = unwrap(n.left)
      if (ts.isPropertyAccessExpression(lhs) && lhs.expression.kind === ts.SyntaxKind.ThisKeyword) {
        assignsThis = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(node, visit)
  return assignsThis
}

/**
 * Does this callable, whatever its kind, hold state an instance could carry?
 *
 * `resolve` follows one more hop. `makeOuter()` whose body is
 * `return makeInner()` holds nothing itself and returns a call expression, so
 * both halves of the direct test say "no" while the state sits one function
 * away. Bounded at a few hops: this is a heuristic for finding a store, not a
 * call-graph analysis, and an unbounded walk would be a way to hang CI.
 */
function callableHoldsMutableState(
  node: ts.Node,
  scope: string,
  resolve?: (name: string, scope: string) => ResolvedCallable | undefined,
  depth = 0
): boolean {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return classHoldsMutableState(node)
  }
  if (bodyHoldsMutableState(node) && returnsStateCarrier(node)) return true
  if (!resolve || depth >= 3) return false

  let delegates = false
  const visit = (n: ts.Node): void => {
    if (delegates) return
    if (n !== node && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n))) return
    if (ts.isArrowFunction(n) && n !== node) return
    if (ts.isReturnStatement(n) && n.expression) {
      const e = unwrap(n.expression)
      const callee = ts.isCallExpression(e) || ts.isNewExpression(e) ? unwrap(e.expression) : null
      const name = callee && ts.isIdentifier(callee) ? callee.text : null
      // Resolved in the DEFINING module's scope, not the consumer's:
      // `makeOuter` returning `makeInner()` is a name that only exists where
      // `makeOuter` lives.
      const next = name ? resolve(name, scope) : undefined
      if (next && callableHoldsMutableState(next.node, next.scope, resolve, depth + 1))
        delegates = true
      return
    }
    ts.forEachChild(n, visit)
  }
  if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
    const e = unwrap(node.body)
    const callee = ts.isCallExpression(e) || ts.isNewExpression(e) ? unwrap(e.expression) : null
    const name = callee && ts.isIdentifier(callee) ? callee.text : null
    const next = name ? resolve(name, scope) : undefined
    return Boolean(next && callableHoldsMutableState(next.node, next.scope, resolve, depth + 1))
  }
  visit(node)
  return delegates
}

/**
 * Module-scope aliases: `const alias = backing`.
 *
 * `alias.set(…)` is a write to `backing`, and without following the alias the
 * backing container reads as a frozen constant and disappears from the ledger.
 */
function moduleAliases(sf: ts.SourceFile): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const d of stmt.declarationList.declarations) {
      if (!d.initializer || !ts.isIdentifier(d.name)) continue
      const init = unwrapObjectWrapper(d.initializer)
      if (!ts.isIdentifier(init)) continue
      const list = out.get(init.text) ?? []
      list.push(d.name.text)
      out.set(init.text, list)
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
  mutatedElsewhere: (name: string) => boolean = () => false,
  resolveImported?: (localName: string) => ResolvedCallable | undefined,
  resolveInModule?: (name: string, scope: string) => ResolvedCallable | undefined
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
  const locals = localCallables(sf)
  const aliases = moduleAliases(sf)

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
            const alias = new Set(aliases.get(name) ?? [])
            if (!mutatesBinding(sf, name, alias) && !(exported && mutatedElsewhere(name))) continue
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
        if (!d.initializer) continue
        // A ternary is two candidate initializers; either branch can be the
        // site, so each is judged on its own.
        const branches = initializerBranches(d.initializer)
        for (const init of branches) {
          // `const R = class { static seen = new Map() }` — a class EXPRESSION is
          // a class declaration that a `const` is hiding, statics and all.
          if (ts.isClassExpression(init)) {
            const owner = names[0] ?? '(anonymous)'
            for (const member of init.members) {
              if (!ts.isPropertyDeclaration(member)) continue
              if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) continue
              if (!ts.isIdentifier(member.name)) continue
              if (!mutatesStaticMember(sf, owner, member.name.text)) continue
              sites.push({
                file: relPath,
                name: `${owner}.${member.name.text}`,
                kind: 'class-static',
                line: lineOf(member),
                exported,
                initializer: initializerLabel(member.initializer),
              })
            }
            continue
          }

          // `const cache = new Lru()` / `new AsyncLocalStorage()` / `new Proxy()`.
          // Anything constructed at module scope is an instance that outlives a
          // request, so it is a site unless its constructor is a known value type.
          if (ts.isNewExpression(init)) {
            const ctor = unwrap(init.expression)
            const ctorName = ts.isIdentifier(ctor) ? ctor.text : null
            if (ctorName === 'RegExp' && isPureRegExp(init)) continue
            if (ctorName !== null && PURE_CONSTRUCTORS.has(ctorName)) continue
            // `new Intl.DateTimeFormat(…)` / `new Intl.DisplayNames(…)`. Every
            // `Intl` constructor produces an immutable formatter configured
            // entirely by its arguments — the same value type as `new RegExp`,
            // reached through a namespace rather than a bare identifier.
            if (
              ts.isPropertyAccessExpression(ctor) &&
              ts.isIdentifier(ctor.expression) &&
              ctor.expression.text === 'Intl'
            )
              continue
            for (const name of names) {
              sites.push({
                file: relPath,
                name,
                kind: 'instance',
                line: lineOf(d),
                exported,
                initializer: initializerLabel(d.initializer),
              })
            }
            continue
          }

          // `const x = makeThing()` where makeThing closes over mutable state.
          // The callee may be declared here, or imported from another scanned
          // module — `makeStash` is one file-move away from being invisible, and
          // it holds §4.1's top-listed hazard.
          if (ts.isCallExpression(init)) {
            const callee = throughReflectiveCall(init.expression)
            let target: ResolvedCallable | undefined
            if (ts.isIdentifier(callee)) {
              const local = locals.get(callee.text)
              target = local ? { node: local, scope: relPath } : resolveImported?.(callee.text)
            } else if (
              ts.isPropertyAccessExpression(callee) &&
              ts.isIdentifier(callee.expression)
            ) {
              // `import * as F` then `F.makeStash()`. Registered by the resolver
              // under the composed `ns.name`.
              target = resolveImported?.(`${callee.expression.text}.${callee.name.text}`)
            } else if (
              ts.isArrowFunction(callee) ||
              ts.isFunctionExpression(callee) ||
              ts.isClassExpression(callee)
            ) {
              target = { node: callee, scope: relPath }
            }
            const resolveCallable = (n: string, scope: string): ResolvedCallable | undefined => {
              if (scope !== relPath) return resolveInModule?.(n, scope)
              const local = locals.get(n)
              return local ? { node: local, scope: relPath } : resolveImported?.(n)
            }
            if (target && callableHoldsMutableState(target.node, target.scope, resolveCallable)) {
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
      // Both spellings. `globalThis.__db = …` is the one this tree uses, and
      // `globalThis['__db'] = …` is its obvious variant rather than a
      // hypothetical — a property-access-only rule reports nothing for it.
      let owner: string | null = null
      let key: string | null = null
      if (ts.isPropertyAccessExpression(lhs)) {
        const obj = unwrap(lhs.expression)
        if (ts.isIdentifier(obj)) {
          owner = obj.text
          key = lhs.name.text
        }
      } else if (ts.isElementAccessExpression(lhs)) {
        const obj = unwrap(lhs.expression)
        const arg = unwrap(lhs.argumentExpression)
        if (
          ts.isIdentifier(obj) &&
          (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
        ) {
          owner = obj.text
          key = arg.text
        }
      }
      if (owner !== null && key !== null && (owner === 'globalThis' || owner === 'global')) {
        sites.push({
          file: relPath,
          name: `${owner}.${key}`,
          kind: 'global-assign',
          line: lineOf(lhs),
          exported: false,
          initializer: null,
        })
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

/**
 * A callable plus the module it was written in.
 *
 * The module has to travel with the node: source files are parsed WITHOUT
 * parent pointers (they are not needed for anything else and cost memory on
 * every CI run), so `node.getSourceFile()` is unavailable and a second hop
 * would have nowhere to resolve its names.
 */
export interface ResolvedCallable {
  node: ts.Node
  /** Repo-root-relative path of the defining module. */
  scope: string
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
    return { ...f, sf, imported: importedNames(sf), importedAs: importedLocalNames(sf) }
  })

  /**
   * Only a file that *imported* the name can be mutating this binding. Without
   * that restriction any unrelated local of the same name counts — `auth`,
   * `registry`, `cache` are not distinctive identifiers — and the ledger fills
   * with entries whose stated reason would be wrong.
   */
  /**
   * Does any importer write to this exported binding, under whatever LOCAL name
   * it imported it as?
   *
   * `import { registry as reg }` then `reg.set(…)` is a write to `registry`,
   * and matching on the exported name alone misses it entirely — so the
   * container reads as never-written and is suppressed as a frozen constant.
   * Same class as the module-scope alias, one file over.
   */
  const mutatedByAnImporter = (name: string): boolean =>
    parsed.some((p) => {
      const locals = p.importedAs.get(name)
      if (!locals || locals.size === 0) return false
      return mutatesBinding(p.sf, name, locals)
    })

  /**
   * Resolve `import { makeStash } from './x'` to the declaration in `./x`.
   *
   * Without this, a factory is analysable only while it happens to sit in the
   * same file as its call. `magicLinkStash` and `otpStash` — §4.1's top-listed
   * hazard — are seen today purely because `makeStash` is local to
   * `auth/index.ts`; moving it to a helper module would have made both
   * disappear from the scan with nothing failing.
   *
   * First-party only. A specifier that leaves the scanned tree cannot be
   * analysed, which is why `new` is treated as a site on its own rather than
   * relying on knowing what the constructor does.
   */
  const byRelPath = new Map(parsed.map((p) => [p.rel, p]))
  const resolveModule = (
    fromRel: string,
    specifier: string
  ): (typeof parsed)[number] | undefined => {
    const spec = specifier.split('?')[0]
    let target: string | null = null
    if (spec.startsWith('@/')) target = posixJoin('apps/web/src', spec.slice(2))
    else if (spec.startsWith('./') || spec.startsWith('../'))
      target = posixJoin(posixDirname(fromRel), spec)
    else {
      // `@quackback/logger` and friends. These are FIRST-PARTY and their source
      // IS a scanned root, so treating them as unresolvable third-party was not
      // the documented limit — it was a hole. `packages/<name>/src` is the
      // layout every workspace package uses.
      const workspace = /^@quackback\/([a-z-]+)(?:\/(.*))?$/.exec(spec)
      if (workspace) target = posixJoin('packages', workspace[1], 'src', workspace[2] ?? 'index')
    }
    if (target === null) return undefined
    for (const candidate of [`${target}.ts`, `${target}/index.ts`, target]) {
      const hit = byRelPath.get(candidate)
      if (hit) return hit
    }
    return undefined
  }

  const exportedDeclaration = (
    mod: (typeof parsed)[number],
    exportName: string,
    depth = 0
  ): ts.Node | undefined => {
    if (depth > 8) return undefined
    for (const stmt of mod.sf.statements) {
      // Re-export barrels. `export { makeStash } from './factory'` declares
      // nothing in the barrel itself, and 88 files in the scanned roots already
      // use `export … from` — so any factory moved behind an index file would
      // have vanished from the scan with nothing failing. `depth` bounds a
      // re-export cycle so CI cannot hang on one.
      if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
        if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
        const next = resolveModule(mod.rel, stmt.moduleSpecifier.text)
        if (!next) continue
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            if (el.name.text !== exportName) continue
            const hit = exportedDeclaration(next, (el.propertyName ?? el.name).text, depth + 1)
            if (hit) return hit
          }
          continue
        }
        const hit = exportedDeclaration(next, exportName, depth + 1)
        if (hit) return hit
        continue
      }
      if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) continue
      // `export default function foo() {}` answers to the name `default`.
      if (exportName === 'default' && hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) {
        if (ts.isFunctionDeclaration(stmt) && stmt.body) return stmt
        if (ts.isClassDeclaration(stmt)) return stmt
      }
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === exportName && stmt.body) return stmt
      if (ts.isClassDeclaration(stmt) && stmt.name?.text === exportName) return stmt
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.name.text !== exportName || !d.initializer) continue
          const init = unwrap(d.initializer)
          if (
            ts.isArrowFunction(init) ||
            ts.isFunctionExpression(init) ||
            ts.isClassExpression(init)
          )
            return init
        }
      }
    }
    return undefined
  }

  /**
   * localName -> the imported declaration, for one importing file.
   *
   * Keyed by the LOCAL name, so `import { makeStash as build }` resolves under
   * `build`. A default import registers its local name against `default`, and a
   * namespace import registers every callable export as `ns.name` so
   * `F.makeStash()` resolves too. Three separate spellings of the same import,
   * and only one of them used to be understood.
   */
  const importedDeclarations = (file: (typeof parsed)[number]): Map<string, ResolvedCallable> => {
    const out = new Map<string, ResolvedCallable>()
    for (const stmt of file.sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const clause = stmt.importClause
      if (!clause) continue
      const mod = resolveModule(file.rel, stmt.moduleSpecifier.text)
      if (!mod) continue

      if (clause.name) {
        const decl = exportedDeclaration(mod, 'default')
        if (decl) out.set(clause.name.text, { node: decl, scope: mod.rel })
      }
      const bindings = clause.namedBindings
      if (!bindings) continue
      if (ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const decl = exportedDeclaration(mod, (el.propertyName ?? el.name).text)
          if (decl) out.set(el.name.text, { node: decl, scope: mod.rel })
        }
        continue
      }
      for (const modStmt of mod.sf.statements) {
        const names: string[] = []
        if (ts.isFunctionDeclaration(modStmt) && modStmt.name) names.push(modStmt.name.text)
        else if (ts.isClassDeclaration(modStmt) && modStmt.name) names.push(modStmt.name.text)
        else if (ts.isVariableStatement(modStmt)) {
          for (const d of modStmt.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) names.push(d.name.text)
          }
        }
        for (const n of names) {
          const decl = exportedDeclaration(mod, n)
          if (decl) out.set(`${bindings.name.text}.${n}`, { node: decl, scope: mod.rel })
        }
      }
    }
    return out
  }

  /**
   * Resolve a name inside whichever module it was written in.
   *
   * A two-hop factory (`makeOuter()` returning `makeInner()`) needs the second
   * name resolved where `makeOuter` lives, not where it is called — the
   * consumer has never heard of `makeInner`.
   */
  const importsCache = new Map<string, Map<string, ResolvedCallable>>()
  const localsCache = new Map<string, Map<string, ts.Node>>()
  const resolveInModule = (name: string, scope: string): ResolvedCallable | undefined => {
    const mod = byRelPath.get(scope)
    if (!mod) return undefined
    let locals = localsCache.get(mod.rel)
    if (!locals) {
      locals = localCallables(mod.sf)
      localsCache.set(mod.rel, locals)
    }
    let imports = importsCache.get(mod.rel)
    if (!imports) {
      imports = importedDeclarations(mod)
      importsCache.set(mod.rel, imports)
    }
    const local = locals.get(name)
    return local ? { node: local, scope: mod.rel } : imports.get(name)
  }

  const all: StateSite[] = []
  for (const f of parsed) {
    const imported = importedDeclarations(f)
    all.push(
      ...extractSites(f.rel, f.text, mutatedByAnImporter, (n) => imported.get(n), resolveInModule)
    )
  }

  return all.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
}

/** Stable identity for ledger matching. A line number must never be part of it. */
export function siteId(site: Pick<StateSite, 'file' | 'name'>): string {
  return `${site.file}#${site.name}`
}

export interface ContainerCounts {
  /** Module-scope `const` bound to any container, including `{}` and `[]`. */
  declared: number
  /** …of which something writes to. */
  mutated: number
  /** Only `new Map` / `new Set` / `new WeakMap` / `new WeakSet`. */
  constructed: number
  /** …of which something writes to. */
  constructedMutated: number
}

/**
 * How many module-scope containers a file declares, and how many of those the
 * scanner treats as state.
 *
 * §4 says "about 45 other module-scope `Set`/`Map` instances are frozen
 * constants and are safe", and the test that pins the scanner does not flag
 * them should measure that rather than approximate it.
 *
 * Two counting mistakes are already ruled out by the shape of this function,
 * both of which made an earlier version of the number meaningless. A regex over
 * the source counts function-local `const x = new Map()` as well, which inflated
 * it by an order of magnitude. And counting every *container* rather than every
 * constructed `Set`/`Map` sweeps in several hundred ordinary module-scope object
 * and array literals, which is not what §4's sentence is about. `constructed`
 * is the number that matches the claim.
 */
export function countModuleScopeContainers(relPath: string, text: string): ContainerCounts {
  const sf = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    false,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const counts: ContainerCounts = {
    declared: 0,
    mutated: 0,
    constructed: 0,
    constructedMutated: 0,
  }
  for (const stmt of topLevelStatements(sf)) {
    if (isAmbient(stmt, relPath)) continue
    if (!ts.isVariableStatement(stmt)) continue
    if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const d of stmt.declarationList.declarations) {
      if (!isContainerInitializer(d.initializer)) continue
      const init = d.initializer ? unwrap(d.initializer) : undefined
      const constructed =
        init !== undefined &&
        ts.isNewExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text !== 'WorkspaceKeyedCache'
      for (const name of boundNames(d.name)) {
        const isMutated = mutatesBinding(sf, name)
        counts.declared += 1
        if (isMutated) counts.mutated += 1
        if (constructed) {
          counts.constructed += 1
          if (isMutated) counts.constructedMutated += 1
        }
      }
    }
  }
  return counts
}
