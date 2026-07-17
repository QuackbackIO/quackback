import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { exportRuns } from '../schema/export-runs'

describe('export runs schema (migration 0206)', () => {
  it('has the correct table name', () => {
    expect(getTableName(exportRuns)).toBe('export_runs')
  })

  it('carries the columns the workspace export needs', () => {
    const columns = Object.keys(getTableColumns(exportRuns))
    expect(columns.sort()).toEqual(
      [
        'id',
        'status',
        'fileName',
        's3Key',
        'sizeBytes',
        'entityCounts',
        'error',
        'initiatedByPrincipalId',
        'createdAt',
        'finishedAt',
        'expiresAt',
      ].sort()
    )
  })

  it('constrains status to the closed enum and defaults to pending', () => {
    expect([...(exportRuns.status.enumValues ?? [])].sort()).toEqual(
      ['completed', 'failed', 'pending', 'running'].sort()
    )
    expect(exportRuns.status.notNull).toBe(true)
    expect(exportRuns.status.default).toBe('pending')
  })

  it('0206 migration pins the load-bearing constraints', () => {
    const sql = readFileSync(join(__dirname, '../../drizzle/0206_export_runs.sql'), 'utf8')
    // Initiator: restrict so a run's history survives, but the initiating
    // principal can't be deleted out from under it.
    expect(sql).toMatch(
      /FOREIGN KEY \("initiated_by_principal_id"\) REFERENCES "principal"\("id"\) ON DELETE restrict/
    )
    expect(sql).toMatch(/"status" text DEFAULT 'pending' NOT NULL/)
    // One active (pending/running) run per deployment: the constant-expression
    // partial unique index the 409 race guard relies on.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "export_runs_active_idx" ON "export_runs" \(\(1\)\) WHERE "status" IN \('pending', 'running'\)/
    )
  })
})
