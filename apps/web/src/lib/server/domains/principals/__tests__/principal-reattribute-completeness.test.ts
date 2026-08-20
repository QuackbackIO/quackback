/**
 * Enforcement for the authored-content re-attribution registry: every
 * ON DELETE RESTRICT reference to a principal must have a step, because
 * RESTRICT is precisely the set that aborts the principal delete. A new
 * RESTRICT column added without a step reintroduces the foreign-key failure
 * that surfaces to an admin as a generic database error, so it fails here
 * with instructions instead.
 *
 * The walk reads the schema rather than a hand-kept list, so it cannot drift
 * from the tables that actually exist. CASCADE and SET NULL references are
 * deliberately out of scope: Postgres already resolves them, and they carry
 * derived or actor state rather than authored content.
 */
import { describe, it, expect } from 'vitest'
import { getTableName, is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
// The walk must see the FULL schema; the app barrel (@/lib/server/db) is a
// curated re-export, and a table missing from it would escape this audit.
// oxlint-disable-next-line no-restricted-imports
import * as schema from '@quackback/db/schema'
import { toUuid } from '@quackback/ids'
import {
  DELETED_USER_PRINCIPAL_ID,
  REATTRIBUTE_STEPS,
  type ReattributeStep,
} from '../principal-reattribute'

/** Every `table.column` whose FK to principal.id is ON DELETE RESTRICT. */
function walkRestrictReferences(): Set<string> {
  const hits = new Set<string>()
  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue
    const tableName = getTableName(exported)
    if (tableName === 'principal') continue // the referenced entity itself
    for (const fk of getTableConfig(exported).foreignKeys) {
      if (fk.onDelete !== 'restrict') continue
      const ref = fk.reference()
      if (getTableName(ref.foreignTable) !== 'principal') continue
      for (const column of ref.columns) hits.add(`${tableName}.${column.name}`)
    }
  }
  return hits
}

/** The schema walk is pure and the schema is fixed; compute it once for the suite. */
const RESTRICT_REFERENCES = walkRestrictReferences()

/** Pure checker so the failure mode itself is testable (see below). */
function auditCoverage(steps: readonly Pick<ReattributeStep, 'table' | 'column'>[]): string[] {
  const covered = new Set(steps.map((s) => `${s.table}.${s.column}`))
  const violations: string[] = []

  for (const key of RESTRICT_REFERENCES) {
    if (!covered.has(key)) {
      violations.push(
        `${key} is an ON DELETE RESTRICT reference to principal.id with no re-attribution step. ` +
          `Add one to REATTRIBUTE_STEPS in principal-reattribute.ts, otherwise removing a portal ` +
          `user who owns one of these rows fails with a raw foreign-key violation.`
      )
    }
  }
  for (const step of steps) {
    const key = `${step.table}.${step.column}`
    if (!RESTRICT_REFERENCES.has(key)) {
      violations.push(
        `Stale step: ${key} is no longer an ON DELETE RESTRICT reference to principal.id; ` +
          `remove it from REATTRIBUTE_STEPS.`
      )
    }
  }
  return violations
}

describe('principal re-attribution completeness', () => {
  it('finds the restrict references the removal path trips over', () => {
    expect(RESTRICT_REFERENCES.has('posts.principal_id')).toBe(true)
    expect(RESTRICT_REFERENCES.has('post_comments.principal_id')).toBe(true)
    expect(RESTRICT_REFERENCES.has('conversations.visitor_principal_id')).toBe(true)
    // Cascade and set-null references are resolved by Postgres, not by a step.
    expect(RESTRICT_REFERENCES.has('post_votes.principal_id')).toBe(false)
    expect(RESTRICT_REFERENCES.has('posts.owner_principal_id')).toBe(false)
  })

  it('every restrict reference to a principal has a re-attribution step', () => {
    expect(auditCoverage(REATTRIBUTE_STEPS)).toEqual([])
  })

  it('fails with guidance when a step is missing', () => {
    const withoutPosts = REATTRIBUTE_STEPS.filter((s) => s.table !== 'posts')
    const violations = auditCoverage(withoutPosts)
    expect(violations.some((v) => v.includes('posts.principal_id'))).toBe(true)
    expect(violations.some((v) => v.includes('REATTRIBUTE_STEPS'))).toBe(true)
  })

  it('fails when a step goes stale', () => {
    const violations = auditCoverage([
      ...REATTRIBUTE_STEPS,
      { table: 'ghost_table', column: 'principal_id' },
    ])
    expect(violations.some((v) => v.includes('Stale step: ghost_table.principal_id'))).toBe(true)
  })

  it('documents why each piece of content outlives its author', () => {
    for (const step of REATTRIBUTE_STEPS) {
      expect(step.description.length, `${step.table}.${step.column}`).toBeGreaterThan(0)
    }
  })
})

describe('deleted-user placeholder id', () => {
  it('is the nil UUID, so the literal and the stored uuid cannot drift apart', () => {
    expect(toUuid(DELETED_USER_PRINCIPAL_ID)).toBe('00000000-0000-0000-0000-000000000000')
  })
})
