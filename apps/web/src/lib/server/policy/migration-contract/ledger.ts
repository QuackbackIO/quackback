/**
 * Evaluates scanned migrations against the `@contract` annotation rule and
 * renders the reviewable golden document (`CONTRACT.md`). The sibling of
 * `../dep-graph/graph.ts` and `../authz-matrix/matrix.ts`: pure functions
 * over the scanner's output, no filesystem access of their own except the
 * one directory walk in `scanMigrationsDir`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { scanMigrationFile, type DestructiveFinding, type ScannedMigration } from './scan'

export function scanMigrationsDir(dirAbs: string): ScannedMigration[] {
  const files = readdirSync(dirAbs)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
  return files.map((f) => scanMigrationFile(f, readFileSync(join(dirAbs, f), 'utf8')))
}

export type Verdict =
  /** No destructive DDL found; nothing to annotate. */
  | { status: 'clean' }
  /** Destructive DDL, carries a valid `-- @contract: safe-after X.Y.Z`. */
  | { status: 'annotated'; version: string }
  /** Destructive DDL, no annotation, but frozen into GRANDFATHERED_MIGRATIONS. */
  | { status: 'grandfathered' }
  /** A `-- @contract:` line is present but doesn't match the required format. */
  | { status: 'malformed_annotation'; raw: string }
  /** Destructive DDL, no annotation, not grandfathered — the CI failure case. */
  | { status: 'violation' }

export interface EvaluatedMigration {
  file: string
  findings: DestructiveFinding[]
  verdict: Verdict
}

/**
 * The annotation policy is file-level, not statement-level: one valid
 * `-- @contract: safe-after X.Y.Z` comment anywhere in the file covers every
 * destructive statement in it. A migration file is already the atomic
 * deploy/review unit (drizzle's journal orders and applies them one at a
 * time), so a single contract claim for the whole file is the natural grain
 * — see README.md for the tradeoff this accepts.
 */
export function evaluateMigration(
  scanned: ScannedMigration,
  allowlist: ReadonlySet<string>
): EvaluatedMigration {
  const { file, findings, annotations, malformed } = scanned
  if (findings.length === 0) {
    return { file, findings, verdict: { status: 'clean' } }
  }
  if (annotations.length > 0) {
    return { file, findings, verdict: { status: 'annotated', version: annotations[0].version } }
  }
  if (malformed.length > 0) {
    return { file, findings, verdict: { status: 'malformed_annotation', raw: malformed[0].raw } }
  }
  if (allowlist.has(file)) {
    return { file, findings, verdict: { status: 'grandfathered' } }
  }
  return { file, findings, verdict: { status: 'violation' } }
}

export function evaluateAll(
  scanned: ScannedMigration[],
  allowlist: ReadonlySet<string>
): EvaluatedMigration[] {
  return scanned.map((s) => evaluateMigration(s, allowlist))
}

/** Migrations CI must fail on: a real violation, or a broken annotation attempt. */
export function blockingFailures(evaluated: EvaluatedMigration[]): EvaluatedMigration[] {
  return evaluated.filter(
    (e) => e.verdict.status === 'violation' || e.verdict.status === 'malformed_annotation'
  )
}

/**
 * Allowlist entries that no longer need to exist: the migration was
 * retroactively annotated, no longer parses as destructive, or was removed.
 * Kept small and always-clean the same way authz-matrix treats a stale
 * classification as a reconciliation error.
 */
export function staleAllowlistEntries(
  evaluated: EvaluatedMigration[],
  allowlist: ReadonlySet<string>
): string[] {
  const byFile = new Map(evaluated.map((e) => [e.file, e]))
  const stale: string[] = []
  for (const file of allowlist) {
    const e = byFile.get(file)
    if (!e || e.verdict.status !== 'grandfathered') stale.push(file)
  }
  return stale.sort((a, b) => a.localeCompare(b))
}

const KIND_LABEL: Record<DestructiveFinding['kind'], string> = {
  drop_column: 'DROP COLUMN',
  drop_table: 'DROP TABLE',
  drop_view: 'DROP VIEW',
  drop_type: 'DROP TYPE',
  drop_constraint: 'DROP CONSTRAINT',
  rename_column: 'RENAME COLUMN',
  rename_table: 'RENAME TO (table)',
  set_not_null: 'SET NOT NULL',
  alter_type: 'ALTER COLUMN TYPE',
  drop_default: 'DROP DEFAULT',
}

const VERDICT_LABEL: Record<Verdict['status'], string> = {
  clean: 'clean',
  annotated: 'annotated',
  grandfathered: 'grandfathered',
  malformed_annotation: 'MALFORMED ANNOTATION',
  violation: 'VIOLATION',
}

/** Render the golden `CONTRACT.md` report from a full evaluated set. */
export function renderContractDoc(
  evaluated: EvaluatedMigration[],
  allowlist: ReadonlySet<string>
): string {
  const withFindings = evaluated.filter((e) => e.findings.length > 0)
  const kindTotals = new Map<string, number>()
  for (const e of withFindings) {
    for (const f of e.findings) {
      kindTotals.set(f.kind, (kindTotals.get(f.kind) ?? 0) + 1)
    }
  }

  const lines: string[] = []
  lines.push('# Migration contract ledger (generated, do not edit by hand)')
  lines.push('')
  lines.push(
    'Regenerate with `bunx vitest run apps/web/src/lib/server/policy/migration-contract -u`. ' +
      'A diff here means a migration gained, lost, or re-annotated destructive DDL — review it ' +
      'as a schema-compatibility change, then commit the regenerated file.'
  )
  lines.push('')
  lines.push(
    '**Do not "fix" a red CI run by adding a new filename to `grandfathered.ts` and regenerating.** ' +
      'That list is frozen to the migrations that predate this linter. A new migration with an ' +
      'unannotated finding needs a `-- @contract: safe-after X.Y.Z` comment in the migration file, ' +
      'not an allowlist entry. See README.md.'
  )
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(
    `Migrations scanned: ${evaluated.length}. Migrations with destructive DDL: ${withFindings.length}.`
  )
  lines.push('')
  lines.push('| Kind | Occurrences |')
  lines.push('| --- | --- |')
  for (const kind of Object.keys(KIND_LABEL) as DestructiveFinding['kind'][]) {
    const n = kindTotals.get(kind) ?? 0
    if (n > 0) lines.push(`| ${KIND_LABEL[kind]} | ${n} |`)
  }
  lines.push('')
  lines.push('## Migrations with destructive DDL')
  lines.push('')
  lines.push('| File | Findings | Verdict |')
  lines.push('| --- | --- | --- |')
  for (const e of withFindings) {
    const findingList = e.findings
      .map((f) => {
        // drop_table / drop_view / drop_type / rename_table already fold the
        // dropped/renamed name into `detail`; prefixing it again would read
        // as `t.t` / `t.t -> new`.
        const subject =
          f.kind === 'drop_table' ||
          f.kind === 'drop_view' ||
          f.kind === 'drop_type' ||
          f.kind === 'rename_table'
            ? f.detail
            : `${f.table ?? ''}.${f.detail}`
        return `${KIND_LABEL[f.kind]} ${subject}`
      })
      .join('; ')
    const verdict =
      e.verdict.status === 'annotated'
        ? `annotated (safe-after ${e.verdict.version})`
        : VERDICT_LABEL[e.verdict.status]
    lines.push(`| ${e.file} | ${findingList} | ${verdict} |`)
  }
  lines.push('')
  lines.push(`## Grandfathered (${allowlist.size})`)
  lines.push('')
  lines.push(
    'Historical migrations exempted from the annotation requirement because they predate this ' +
      'linter. Frozen — see `grandfathered.ts`.'
  )
  lines.push('')
  for (const file of [...allowlist].sort((a, b) => a.localeCompare(b))) {
    lines.push(`- ${file}`)
  }
  lines.push('')

  return lines.join('\n')
}
