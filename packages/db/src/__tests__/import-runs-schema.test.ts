import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { importRuns } from '../schema/import-runs'

describe('import runs schema (migration 0160)', () => {
  it('has the correct table name', () => {
    expect(getTableName(importRuns)).toBe('import_runs')
  })

  it('carries exactly the columns the imports & exports hub spec calls for', () => {
    const columns = Object.keys(getTableColumns(importRuns))
    expect(columns.sort()).toEqual(
      [
        'id',
        'source',
        'fileName',
        'initiatedByPrincipalId',
        'status',
        'totals',
        'errorReport',
        'batchTagId',
        'createdAt',
        'finishedAt',
      ].sort()
    )
  })

  it('constrains source and status to the closed enums', () => {
    expect([...(importRuns.source.enumValues ?? [])].sort()).toEqual(
      ['api', 'canny', 'csv', 'uservoice'].sort()
    )
    expect([...(importRuns.status.enumValues ?? [])].sort()).toEqual(
      ['completed', 'dry_run', 'failed', 'pending', 'running'].sort()
    )
  })

  it('defaults status to pending', () => {
    expect(importRuns.status.notNull).toBe(true)
    expect(importRuns.status.default).toBe('pending')
  })

  it('0160 migration pins the load-bearing constraints', () => {
    const sql = readFileSync(join(__dirname, '../../drizzle/0160_import_runs.sql'), 'utf8')
    // Author of the run: restrict so a run's history survives, but the
    // initiating principal can't be deleted out from under it.
    expect(sql).toMatch(
      /FOREIGN KEY \("initiated_by_principal_id"\) REFERENCES "principal"\("id"\) ON DELETE restrict/
    )
    // Batch tag: set null on delete, never cascade — losing the tag must not
    // delete import history.
    expect(sql).toMatch(
      /FOREIGN KEY \("batch_tag_id"\) REFERENCES "post_tags"\("id"\) ON DELETE set null/
    )
    expect(sql).toMatch(/"status" text DEFAULT 'pending' NOT NULL/)
  })
})
