/**
 * The queue-package ban: no file under `apps/web/src` may import `bullmq`.
 *
 * ## What this replaces, and why it is stricter
 *
 * `queue/create-worker.ts` used to be a seam that refused to construct a BullMQ
 * `Worker` under pooled tenancy. The defect it existed to remove is worth
 * restating, because it is the reason this file exists at all: a `Worker`'s
 * `run()` loop starts synchronously inside its constructor, so the
 * AsyncLocalStorage context alive at construction becomes the context for every
 * job it ever processes. That store is where `getCurrentWorkspace()` lives, and
 * most of those workers armed lazily on first enqueue — from inside a request.
 * So under pooled tenancy the first request to trigger an export or an import
 * welded its own workspace onto the processor, and every other workspace's jobs then
 * ran against that one database: no error, no failed permission check,
 * self-consistent rows from the wrong workspace.
 *
 * The seam is gone because the eight modules it guarded were rewritten onto the
 * Postgres job tier, which opens a real workspace scope per claim. Deleting a
 * control without replacing it is not a thing this area does, so the control
 * became a stricter one:
 *
 *   the seam         "no `Worker` is constructed under pooled tenancy"
 *   this scanner     "the package is not imported, anywhere, ever"
 *
 * You cannot construct a `Worker` without importing the package, so this
 * subsumes everything the seam checked — including the twenty-one bypass shapes
 * that were thrown at it — and it has no adjudicated-importer escape hatch to
 * argue your way through. The failure mode it prevents is not "someone calls
 * the old seam"; it is a new queue module reintroducing an in-process consumer
 * whose run loop inherits whichever request armed it.
 *
 * ## Why AST and not grep
 *
 * Two reasons, and the second is the one that would have bitten.
 *
 * A tokenizer-free text search cannot tell an import from the word `bullmq` in
 * a comment, and this tree has thirty-odd such comments — every one of them a
 * false positive that would train a reader to ignore the check.
 *
 * And `grep` in this environment passes `-I`, which silently skips a file
 * containing a NUL byte. Four files under `apps/web/src` carry raw NUL bytes
 * today, so a grep-based ban would report a confident zero for exactly those
 * four, forever, with nothing to see. Reading and parsing has no such hole, and
 * `__tests__/no-bullmq.test.ts` pins it with a NUL-carrying fixture.
 *
 * ## The shapes it must catch
 *
 * Every spelling that puts the module in the graph, because the point is the
 * package, not the syntax:
 *
 *   import { Worker } from 'bullmq'          static
 *   import 'bullmq'                          bare, side-effect only
 *   export { Worker } from 'bullmq'          re-export
 *   await import('bullmq')                   dynamic
 *   require('bullmq')                        CJS
 *   import bull = require('bullmq')          TS import-equals
 *   import type { Job } from 'bullmq'        type-only
 *   type J = import('bullmq').Job            type-position import
 *   import { Worker } from 'bullmq/dist/…'   subpath
 *
 * Type-only imports count. The module is still in the graph conceptually, the
 * `type` keyword is one edit away from not being there, and a `Job` type
 * imported into a handler signature is how a real consumer starts.
 *
 * ## Scope: everything, including tests
 *
 * This deliberately does NOT use `policy/source-files.ts#walkSourceFiles`,
 * which skips `__tests__` and `*.test.ts` — the right scope for the scanners
 * that reconcile production code against a ledger, and the wrong one here. A
 * test that imports `bullmq` keeps the package alive in the graph and gives the
 * next `Worker` somewhere to be constructed and asserted on, which is precisely
 * the shape of the file this ban replaced. The ban is on the package.
 *
 * `bullmq` stays in `apps/web/package.json` for now; removing the dependency is
 * strictly better and is a follow-up. Until then this scanner is what makes the
 * unused dependency stay unused.
 */
import * as ts from '@typescript/typescript6'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** The banned package. Its own subpaths are banned with it. */
export const BANNED_PACKAGE = 'bullmq'

export type BannedImportKind =
  'import' | 'export-from' | 'dynamic-import' | 'require' | 'import-equals' | 'import-type'

export interface BannedImport {
  /** Path relative to the scanned root, posix-normalized. */
  file: string
  line: number
  kind: BannedImportKind
  /** The specifier as written, so a subpath import reads as one. */
  specifier: string
  /** Recorded, never excused — see the module docblock. */
  typeOnly: boolean
}

/**
 * Every `.ts`/`.tsx` file under a root, tests included.
 *
 * Separate from `walkSourceFiles` on purpose; the docblock says why. `dist` and
 * `node_modules` are skipped for the same reason every other scanner skips
 * them: they are build output and third-party code, not this tree's decisions.
 */
export function walkAllTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (entry.isDirectory()) {
      walkAllTsFiles(p, acc)
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      acc.push(p)
    }
  }
  return acc
}

/**
 * Does this specifier name the banned package?
 *
 * The package itself or any subpath below it, with a Vite query suffix
 * (`?url`, `?raw`) stripped first. `bullmq-pro` and `./bullmq` are other
 * modules and are not matched — the prefix test requires a `/` boundary.
 */
export function isBannedSpecifier(specifier: string): boolean {
  const spec = specifier.split('?')[0]
  return spec === BANNED_PACKAGE || spec.startsWith(`${BANNED_PACKAGE}/`)
}

/** Every banned-package reference in one file's text. */
export function findBannedImportsInText(relPath: string, text: string): BannedImport[] {
  const sf = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found: BannedImport[] = []
  const record = (
    node: ts.Node,
    specifier: string,
    kind: BannedImportKind,
    typeOnly: boolean
  ): void => {
    if (!isBannedSpecifier(specifier)) return
    found.push({
      file: relPath,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
      specifier,
      typeOnly,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      // Covers the bare side-effect form too: `import 'bullmq'` is an
      // ImportDeclaration with no importClause at all.
      record(node, node.moduleSpecifier.text, 'import', node.importClause?.isTypeOnly === true)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text, 'export-from', node.isTypeOnly)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node, node.moduleReference.expression.text, 'import-equals', node.isTypeOnly)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      record(node, node.argument.literal.text, 'import-type', true)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node, node.arguments[0].text, 'dynamic-import', false)
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        record(node, node.arguments[0].text, 'require', false)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/**
 * Scan a whole tree. Sorted by file then line so a failure reads the same way
 * twice and a diff of it is legible.
 */
export function findBannedImports(rootAbs: string): BannedImport[] {
  const found: BannedImport[] = []
  for (const absPath of walkAllTsFiles(rootAbs)) {
    const relPath = relative(rootAbs, absPath).split('\\').join('/')
    found.push(...findBannedImportsInText(relPath, readFileSync(absPath, 'utf8')))
  }
  found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return found
}

/** One line per finding, for the gate's failure message. */
export function describeBannedImport(f: BannedImport): string {
  return `${f.file}:${f.line} — ${f.kind}${f.typeOnly ? ' (type-only)' : ''} of '${f.specifier}'`
}
