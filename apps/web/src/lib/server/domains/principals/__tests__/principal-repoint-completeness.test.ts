/**
 * Enforcement for the principal re-point registry: every column in the schema
 * that references a principal must either be migrated by a registry step or
 * carry an explicit exemption with a reason. A new principal-referencing table
 * added without either fails here with instructions.
 *
 * Detection is the union of:
 * - real foreign keys targeting principal.id (catches created_by_id etc.)
 * - the naming convention `principal_id` / `*_principal_id` (catches the
 *   documented soft references without FKs, e.g. page_views, visitor_devices)
 *
 * REQUIREMENT this walk relies on: a soft principal reference MUST be named
 * `principal_id` / `*_principal_id` or carry a real FK to principal.id. A
 * soft reference under any other name with no FK is the audit's blind spot —
 * it is invisible here and would silently strand rows on merge.
 */
import { describe, it, expect } from 'vitest'
import { getTableName, is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
// The walk must see the FULL schema; the app barrel (@/lib/server/db) is a
// curated re-export, and a table missing from it would escape this audit.
// eslint-disable-next-line no-restricted-imports
import * as schema from '@quackback/db/schema'
import { REPOINT_STEPS, REPOINT_EXEMPTIONS, type RepointStep } from '../principal-repoint'

/** All principal-referencing columns in the schema, keyed `table.column`. */
function walkPrincipalReferences(): Map<string, string> {
  const hits = new Map<string, string>()
  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue
    const tableName = getTableName(exported)
    if (tableName === 'principal') continue // the referenced entity itself
    const config = getTableConfig(exported)

    for (const fk of config.foreignKeys) {
      const ref = fk.reference()
      if (getTableName(ref.foreignTable) !== 'principal') continue
      for (const column of ref.columns) {
        hits.set(`${tableName}.${column.name}`, 'foreign key to principal.id')
      }
    }
    for (const column of config.columns) {
      const key = `${tableName}.${column.name}`
      if (hits.has(key)) continue
      if (column.name === 'principal_id' || column.name.endsWith('_principal_id')) {
        hits.set(key, 'principal-id naming convention (soft reference)')
      }
    }
  }
  return hits
}

/** The schema walk is pure and the schema is fixed; compute it once for the suite. */
const REFERENCES = walkPrincipalReferences()

/** Pure checker so the failure mode itself is testable (see red-green below). */
function auditCoverage(
  steps: readonly Pick<RepointStep, 'table' | 'columns'>[],
  exemptions: Record<string, string>
): string[] {
  const covered = new Set(steps.flatMap((s) => s.columns.map((c) => `${s.table}.${c}`)))
  const references = REFERENCES
  const violations: string[] = []

  for (const [key, how] of references) {
    const isCovered = covered.has(key)
    const isExempt = key in exemptions
    if (isCovered && isExempt) {
      violations.push(`${key} is both covered by a registry step and exempted; remove one.`)
    } else if (!isCovered && !isExempt) {
      violations.push(
        `${key} references principals (${how}) but the merge does not handle it. ` +
          `Add a re-point step to REPOINT_STEPS or an exemption with a reason to ` +
          `REPOINT_EXEMPTIONS in principal-repoint.ts, otherwise the ` +
          `anonymous-to-identified merge silently strands or drops these rows.`
      )
    }
  }
  for (const key of Object.keys(exemptions)) {
    if (!references.has(key)) {
      violations.push(
        `Stale exemption: ${key} no longer references principals; remove it from REPOINT_EXEMPTIONS.`
      )
    }
  }
  return violations
}

describe('principal re-point completeness', () => {
  it('finds the documented soft references, so naming detection works', () => {
    expect(REFERENCES.has('page_views.principal_id')).toBe(true)
    expect(REFERENCES.has('visitor_devices.principal_id')).toBe(true)
    // FK-only naming (no principal_id suffix) is caught via the FK walk
    expect(REFERENCES.has('api_keys.created_by_id')).toBe(true)
  })

  it('every principal-referencing column is re-pointed or explicitly exempted', () => {
    expect(auditCoverage(REPOINT_STEPS, REPOINT_EXEMPTIONS)).toEqual([])
  })

  it('fails with guidance when a registry step is removed', () => {
    const withoutSegments = REPOINT_STEPS.filter((s) => s.table !== 'user_segments')
    const violations = auditCoverage(withoutSegments, REPOINT_EXEMPTIONS)
    expect(violations.some((v) => v.includes('user_segments.principal_id'))).toBe(true)
    expect(violations.some((v) => v.includes('REPOINT_STEPS'))).toBe(true)
  })

  it('fails when an exemption goes stale', () => {
    const violations = auditCoverage(REPOINT_STEPS, {
      ...REPOINT_EXEMPTIONS,
      'ghost_table.principal_id': 'this table was deleted',
    })
    expect(violations.some((v) => v.includes('Stale exemption: ghost_table.principal_id'))).toBe(
      true
    )
  })
})
