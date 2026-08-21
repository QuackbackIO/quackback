/**
 * `SCAN_TABLES` pinned against the real Drizzle schema.
 *
 * A misspelled table name is the quietest possible way to weaken this suite:
 * `information_schema` simply returns no columns for it, the scan narrows, and
 * every database-backed probe reports a clean result over less ground than it
 * claims. That is exactly what happened — the list carried `notifications`,
 * which does not exist; the table is `in_app_notifications`.
 *
 * Runtime reporting exists too (`scanCoverage` fails a `visibility` control when
 * `information_schema` does not know a requested table), but that only fires
 * when someone runs the suite against a live database. This fires in
 * `bun run test`.
 */

import { describe, expect, it } from 'vitest'
import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
// The repo reserves `@quackback/db/*` for the server re-export layer and
// standalone scripts, so app code cannot bypass `@/lib/server/db`. This test
// needs the raw Drizzle table objects — it is asserting on schema METADATA, not
// querying anything — and going through the server barrel would drag in the
// database client and its config for a test that touches no database. Reading
// the names out of the source with a regex was the alternative, and that is the
// approach that let `notifications` sit in the scan list unnoticed.
// oxlint-disable-next-line no-restricted-imports
import * as schema from '@quackback/db/schema'
import { SCAN_TABLES, FIXTURE_TABLES } from '../db-scan'

function schemaTableNames(): Set<string> {
  const names = new Set<string>()
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) names.add(getTableName(value))
  }
  return names
}

describe('SCAN_TABLES', () => {
  it('names only tables that exist in the schema', () => {
    const actual = schemaTableNames()
    const missing = SCAN_TABLES.filter((table) => !actual.has(table))
    expect(missing, `not real tables: ${missing.join(', ')}`).toEqual([])
  })

  it('covers the tables a misrouted write would most plausibly land in', () => {
    // Not an exhaustive list by design — the scan is bounded so the suite stays
    // fast enough to be run after every builder round. But these five are the
    // load-bearing ones for P07, P08 and P09, and dropping one silently would
    // narrow the suite without any test noticing.
    for (const table of [
      'posts',
      'events',
      'conversation_messages',
      'assistant_involvements',
      'principal',
    ]) {
      expect(SCAN_TABLES, `${table} must stay in the scan list`).toContain(table)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(SCAN_TABLES).size).toBe(SCAN_TABLES.length)
  })

  it('marks the fixture-owned tables, so a visibility guard cannot be satisfied by fixture data', () => {
    // P07 asks "did this write produce derived rows?" and must not accept rows
    // the fixture itself wrote. Both fixture tables have to be excluded, and
    // both have to be real.
    const actual = schemaTableNames()
    for (const table of FIXTURE_TABLES) {
      expect(actual.has(table), `${table} must be a real table`).toBe(true)
      expect(SCAN_TABLES).toContain(table)
    }
    expect(FIXTURE_TABLES.has('posts')).toBe(true)
    expect(FIXTURE_TABLES.has('boards')).toBe(true)
  })
})
