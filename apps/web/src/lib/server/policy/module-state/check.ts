/**
 * Reconciling the scan against the ledger, and checking the checkable claims.
 *
 * Kept separate from `scan.ts` (what the tree contains) and `ledger.ts` (what
 * we have decided about it) so the failure a reader sees names one of three
 * things: an unledgered site, a stale entry, or a category the source
 * contradicts.
 */
import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanRoots, siteId, type ScanRoot, type StateSite } from './scan'
import { MODULE_STATE_LEDGER, type LedgerEntry, type StateCategory } from './ledger'

/**
 * Does this file consult the REAL tenancy mode?
 *
 * A substring test for `isPooledTenancy` is certification by mention, and this
 * one was defeated on the first attempt: replacing the import with a local
 * `const isPooledTenancy = (): boolean => false` left the string in the file
 * and the check green while the guard was gone. That is the same shape as
 * Piece 5's "unconditional witness" — a helper whose mere name counts as
 * evidence.
 *
 * So the claim is tested structurally: an import of `isPooledTenancy` from the
 * tenancy mode module, or a `config.isPooledTenancy` read, AND no local
 * declaration of that name shadowing it.
 *
 * What this still does not prove is that the guard covers the SITE. That claim
 * lives where it can actually be observed — `__tests__/singletons-not-shared.ts`
 * asserts the relay does not attempt leadership under pooled tenancy and that
 * the readiness probe never reads the migration status. The scanner's job here
 * is to stop the mechanism disappearing quietly, not to re-derive behaviour.
 */
export function readsRealTenancyMode(text: string, fileName: string): boolean {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  let imported = false
  let configRead = false
  let locallyDeclared = false

  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      /workspaces\/mode$/.test(stmt.moduleSpecifier.text.split('?')[0]) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        if ((el.propertyName ?? el.name).text === 'isPooledTenancy') imported = true
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'isPooledTenancy') {
      locallyDeclared = true
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'isPooledTenancy') locallyDeclared = true
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'isPooledTenancy' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'config'
    ) {
      configRead = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return (imported || configRead) && !locallyDeclared
}

/**
 * What "server code" means for this scanner.
 *
 * `lib/shared` is included deliberately. Server code imports it, so a `let`
 * declared there and re-exported through a server module would be module-scope
 * state the scanner never saw — the exact "re-exported state" bypass. Scanning
 * the definition site closes it, and the cost is four ledger lines.
 *
 * `components/` and `lib/client` are excluded: module-scope state in a browser
 * bundle lives in one user's tab, which is a different subject entirely.
 */
export const SERVER_ROOTS: readonly { rel: string }[] = [
  { rel: 'apps/web/src/lib/server' },
  { rel: 'apps/web/src/lib/shared' },
  { rel: 'apps/web/src/routes/api' },
  { rel: 'apps/web/src/integrations' },
  { rel: 'packages/db/src' },
  { rel: 'packages/email/src' },
  { rel: 'packages/logger/src' },
  { rel: 'packages/ids/src' },
]

export function serverRoots(repoRoot: string): ScanRoot[] {
  return SERVER_ROOTS.map((r) => ({ dir: join(repoRoot, r.rel), label: r.rel }))
}

export interface Finding {
  kind: 'unledgered' | 'stale' | 'miscategorised'
  id: string
  detail: string
}

export interface CheckResult {
  sites: StateSite[]
  findings: Finding[]
  byCategory: Record<StateCategory, number>
}

/** Categories whose claim the scanner can test against the source. */
const VERIFIED: ReadonlySet<StateCategory> = new Set([
  'workspace-keyed',
  'workspace-scoped-key',
  'refuses-pooled',
])

export function checkModuleState(repoRoot: string): CheckResult {
  const sites = scanRoots(repoRoot, serverRoots(repoRoot))
  const ledger = new Map<string, LedgerEntry>()
  for (const entry of MODULE_STATE_LEDGER) ledger.set(siteId(entry), entry)

  const findings: Finding[] = []
  const seen = new Set<string>()
  const fileText = new Map<string, string>()
  const read = (file: string): string => {
    let text = fileText.get(file)
    if (text === undefined) {
      text = readFileSync(join(repoRoot, file), 'utf8')
      fileText.set(file, text)
    }
    return text
  }

  const byCategory: Record<StateCategory, number> = {
    'workspace-keyed': 0,
    'workspace-scoped-key': 0,
    'refuses-pooled': 0,
    'content-addressed': 0,
    'fleet-wide': 0,
    'process-lifetime': 0,
  }

  for (const site of sites) {
    const id = siteId(site)
    seen.add(id)
    const entry = ledger.get(id)
    if (!entry) {
      findings.push({
        kind: 'unledgered',
        id,
        detail:
          `${site.kind} at ${site.file}:${site.line} is module-scope mutable state with no ` +
          `entry in policy/module-state/ledger.ts. In a pooled process this survives a REQUEST, ` +
          `which means it survives a WORKSPACE. Add an entry naming what a cross-workspace hit would ` +
          `return — or make it a WorkspaceKeyedCache.`,
      })
      continue
    }
    byCategory[entry.category] += 1
    if (!VERIFIED.has(entry.category)) continue

    if (entry.category === 'workspace-keyed' && site.kind !== 'factory') {
      if (site.initializer !== 'new WorkspaceKeyedCache') {
        findings.push({
          kind: 'miscategorised',
          id,
          detail:
            `declared 'workspace-keyed' but its initializer is ${site.initializer ?? 'not a cache'}, ` +
            `not 'new WorkspaceKeyedCache'. A raw container cannot be labelled workspace-keyed.`,
        })
      }
    }
    if (entry.category === 'workspace-scoped-key') {
      if (!entry.keyedBy) {
        findings.push({
          kind: 'miscategorised',
          id,
          detail: `declared 'workspace-scoped-key' with no 'keyedBy' naming the code that composes the key.`,
        })
      } else if (!read(site.file).includes(entry.keyedBy)) {
        findings.push({
          kind: 'miscategorised',
          id,
          detail:
            `declared 'workspace-scoped-key' with keyedBy '${entry.keyedBy}', which does not appear ` +
            `in ${site.file}. The key composition it points at is gone.`,
        })
      }
    }
    if (entry.category === 'refuses-pooled' && !readsRealTenancyMode(read(site.file), site.file)) {
      findings.push({
        kind: 'miscategorised',
        id,
        detail:
          `declared 'refuses-pooled' but ${site.file} does not import 'isPooledTenancy' from ` +
          `tenancy/mode (or read 'config.isPooledTenancy'), or shadows it with a local ` +
          `declaration — so nothing stops it running under pooled tenancy.`,
      })
    }
  }

  for (const entry of MODULE_STATE_LEDGER) {
    const id = siteId(entry)
    if (seen.has(id)) continue
    findings.push({
      kind: 'stale',
      id,
      detail:
        `ledger names ${id}, which the scanner no longer finds. Delete the entry — a ledger that ` +
        `keeps justifications for code that is gone stops being readable as the current picture.`,
    })
  }

  return { sites, findings, byCategory }
}

/** One line per site, for the MODULE-STATE.md golden snapshot. */
export function renderLedgerDoc(result: CheckResult): string {
  const order: StateCategory[] = [
    'workspace-keyed',
    'workspace-scoped-key',
    'refuses-pooled',
    'content-addressed',
    'fleet-wide',
    'process-lifetime',
  ]
  const byId = new Map(MODULE_STATE_LEDGER.map((e) => [siteId(e), e]))
  const lines: string[] = [
    '# Module-scope mutable state',
    '',
    'Generated by `policy/module-state/__tests__/module-state.test.ts`. Do not edit by hand.',
    '',
    `${result.sites.length} sites across ${new Set(result.sites.map((s) => s.file)).size} files.`,
    '',
    '| category | count |',
    '| --- | --- |',
    ...order.map((c) => `| ${c} | ${result.byCategory[c]} |`),
    '',
  ]
  for (const category of order) {
    lines.push(`## ${category}`, '', '| site | kind | owner |', '| --- | --- | --- |')
    for (const site of result.sites) {
      const entry = byId.get(siteId(site))
      if (entry?.category !== category) continue
      lines.push(`| \`${site.file}\` · ${site.name} | ${site.kind} | ${entry.owner ?? '—'} |`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
