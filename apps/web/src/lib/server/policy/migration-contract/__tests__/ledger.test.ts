import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { scanMigrationFile } from '../scan'
import {
  scanMigrationsDir,
  evaluateAll,
  evaluateMigration,
  blockingFailures,
  staleAllowlistEntries,
  renderContractDoc,
} from '../ledger'
import { GRANDFATHERED_MIGRATIONS } from '../grandfathered'

const DRIZZLE_DIR = join(__dirname, '../../../../../../../../packages/db/drizzle')
const ALLOWLIST = new Set(GRANDFATHERED_MIGRATIONS)

const scanned = scanMigrationsDir(DRIZZLE_DIR)
const evaluated = evaluateAll(scanned, ALLOWLIST)

describe('the real migration history', () => {
  it('scans a non-trivial number of migrations (guards against a broken path)', () => {
    expect(scanned.length).toBeGreaterThan(200)
  })

  it('HARD RULE: no unannotated destructive migration outside the frozen allowlist', () => {
    const failures = blockingFailures(evaluated)
    const detail = failures
      .map(
        (f) =>
          `${f.file}: ${f.verdict.status} — ${f.findings.map((x) => `${x.kind} ${x.table}.${x.detail}`).join(', ')}`
      )
      .join('\n')
    expect(failures, `\n${detail}\n`).toEqual([])
  })

  it('the frozen allowlist has no stale entries', () => {
    const stale = staleAllowlistEntries(evaluated, ALLOWLIST)
    expect(
      stale,
      `\nThese migrations no longer need grandfathering (already annotated, or no longer parse as ` +
        `destructive) — remove them from grandfathered.ts:\n${stale.join('\n')}\n`
    ).toEqual([])
  })

  it('every grandfathered file is still a real migration on disk', () => {
    const files = new Set(scanned.map((s) => s.file))
    for (const f of GRANDFATHERED_MIGRATIONS) {
      expect(
        files.has(f),
        `${f} is in grandfathered.ts but no longer exists in packages/db/drizzle`
      ).toBe(true)
    }
  })
})

describe('golden contract ledger', () => {
  it('matches the committed CONTRACT.md snapshot', async () => {
    const doc = renderContractDoc(evaluated, ALLOWLIST)
    await expect(doc).toMatchFileSnapshot(join(__dirname, '../CONTRACT.md'))
  })
})

/**
 * The acceptance bar for the expand/contract discipline, proven directly against
 * the real scan + evaluate pipeline rather than the live filesystem: a brand
 * new destructive migration with no annotation must fail, and the identical
 * migration with a valid annotation must pass — without touching the frozen
 * allowlist either time.
 */
describe('a new destructive migration (acceptance bar)', () => {
  const unannotated = scanMigrationFile(
    '9999_drop_legacy_slug.sql',
    `ALTER TABLE "posts" DROP COLUMN "legacy_slug";`
  )
  const annotated = scanMigrationFile(
    '9999_drop_legacy_slug.sql',
    `-- @contract: safe-after 0.14.0\nALTER TABLE "posts" DROP COLUMN "legacy_slug";`
  )

  it('fails when the migration carries no annotation and is not grandfathered', () => {
    const verdict = evaluateMigration(unannotated, ALLOWLIST).verdict
    expect(verdict.status).toBe('violation')
  })

  it('passes once the migration carries a valid annotation', () => {
    const verdict = evaluateMigration(annotated, ALLOWLIST).verdict
    expect(verdict).toEqual({ status: 'annotated', version: '0.14.0' })
  })

  it('a non-destructive new migration needs no annotation at all', () => {
    const additive = scanMigrationFile(
      '9999_add_widget.sql',
      `ALTER TABLE "posts" ADD COLUMN "widget" text;`
    )
    expect(evaluateMigration(additive, ALLOWLIST).verdict).toEqual({ status: 'clean' })
  })

  it('a broken annotation attempt fails distinctly from a missing one', () => {
    const broken = scanMigrationFile(
      '9999_drop_legacy_slug.sql',
      `-- @contract: soon\nALTER TABLE "posts" DROP COLUMN "legacy_slug";`
    )
    expect(evaluateMigration(broken, ALLOWLIST).verdict.status).toBe('malformed_annotation')
  })
})
