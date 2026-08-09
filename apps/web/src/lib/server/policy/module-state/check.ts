/**
 * Reconciling the scan against the ledger, and checking the checkable claims.
 *
 * Kept separate from `scan.ts` (what the tree contains) and `ledger.ts` (what
 * we have decided about it) so the failure a reader sees names one of three
 * things: an unledgered site, a stale entry, or a category the source
 * contradicts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanRoots, siteId, type ScanRoot, type StateSite } from './scan'
import { MODULE_STATE_LEDGER, type LedgerEntry, type StateCategory } from './ledger'

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
  'tenant-keyed',
  'tenant-scoped-key',
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
    'tenant-keyed': 0,
    'tenant-scoped-key': 0,
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
          `which means it survives a TENANT. Add an entry naming what a cross-tenant hit would ` +
          `return — or make it a TenantKeyedCache.`,
      })
      continue
    }
    byCategory[entry.category] += 1
    if (!VERIFIED.has(entry.category)) continue

    if (entry.category === 'tenant-keyed' && site.kind !== 'factory') {
      if (site.initializer !== 'TenantKeyedCache') {
        findings.push({
          kind: 'miscategorised',
          id,
          detail:
            `declared 'tenant-keyed' but its initializer is ${site.initializer ?? 'not a cache'}, ` +
            `not 'new TenantKeyedCache'. A raw container cannot be labelled tenant-keyed.`,
        })
      }
    }
    if (entry.category === 'tenant-scoped-key') {
      if (!entry.keyedBy) {
        findings.push({
          kind: 'miscategorised',
          id,
          detail: `declared 'tenant-scoped-key' with no 'keyedBy' naming the code that composes the key.`,
        })
      } else if (!read(site.file).includes(entry.keyedBy)) {
        findings.push({
          kind: 'miscategorised',
          id,
          detail:
            `declared 'tenant-scoped-key' with keyedBy '${entry.keyedBy}', which does not appear ` +
            `in ${site.file}. The key composition it points at is gone.`,
        })
      }
    }
    if (entry.category === 'refuses-pooled' && !read(site.file).includes('isPooledTenancy')) {
      findings.push({
        kind: 'miscategorised',
        id,
        detail:
          `declared 'refuses-pooled' but ${site.file} never reads 'isPooledTenancy', so nothing ` +
          `stops it running under pooled tenancy.`,
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
    'tenant-keyed',
    'tenant-scoped-key',
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
  return lines.join('\n')
}
