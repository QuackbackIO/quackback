/**
 * Row-level marker scanning.
 *
 * Several probes need to answer "did anything belonging to alpha end up inside
 * bravo's database?" without knowing in advance which table it would land in —
 * a misrouted background job, a memoised service-principal id used as a foreign
 * key, a cached blob written through. Guessing the table is how a leak gets
 * missed, so the scan enumerates the text-bearing columns of a curated table set
 * from `information_schema` and searches every one of them.
 *
 * Scoped to a curated table list rather than the whole schema: unbounded, this
 * would be hundreds of sequential scans, and a probe suite nobody runs because
 * it takes twenty minutes provides no protection at all.
 */

import type { TenantDb } from './types'

/**
 * Tables a cross-tenant write would plausibly land in: content, the event
 * outbox, conversation history, assistant attribution, and the job/run ledgers.
 */
export const SCAN_TABLES = [
  'posts',
  'boards',
  'post_comments',
  'post_activity',
  'events',
  'conversations',
  'conversation_messages',
  'assistant_involvements',
  'notifications',
  'hook_deliveries',
  'import_runs',
  'export_runs',
  'kb_articles',
  'principal',
  'settings',
] as const

/** Hard ceiling on column scans, so a wide schema cannot make a run unbounded. */
const MAX_COLUMN_SCANS = 400

export interface ScanHit {
  table: string
  column: string
  /** A trimmed sample of the matching row's column value. */
  sample: string
}

export interface ScanResult {
  hits: ScanHit[]
  columnsScanned: number
  tablesScanned: number
  /** True when the ceiling truncated the scan; a clean result is then not conclusive. */
  truncated: boolean
}

interface ColumnRow {
  table_name: string
  column_name: string
}

/**
 * Search a tenant database for any occurrence of `marker`.
 *
 * Returns every hit rather than short-circuiting: the set of tables a marker
 * reached is the most useful thing in the report, because it says how far a leak
 * propagated.
 */
export async function scanForMarker(
  db: TenantDb,
  marker: string,
  tables: readonly string[] = SCAN_TABLES
): Promise<ScanResult> {
  if (marker.length < 8) {
    throw new Error(`refusing to scan for a marker shorter than 8 characters: "${marker}"`)
  }

  const columns = await db.query<ColumnRow>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1)
       AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'uuid')
     ORDER BY table_name, ordinal_position`,
    [tables as unknown as string[]]
  )

  const hits: ScanHit[] = []
  const seenTables = new Set<string>()
  let scanned = 0

  for (const col of columns) {
    if (scanned >= MAX_COLUMN_SCANS) {
      return {
        hits,
        columnsScanned: scanned,
        tablesScanned: seenTables.size,
        truncated: true,
      }
    }
    scanned++
    seenTables.add(col.table_name)

    // Identifiers come from information_schema, not from user input, but they
    // are still quoted rather than interpolated bare so a mixed-case or
    // reserved-word column cannot break the statement.
    const table = `"${col.table_name.replace(/"/g, '""')}"`
    const column = `"${col.column_name.replace(/"/g, '""')}"`
    const rows = await db.query<{ sample: string }>(
      `SELECT left(${column}::text, 300) AS sample
       FROM ${table}
       WHERE ${column}::text LIKE $1
       LIMIT 1`,
      [`%${marker}%`]
    )
    if (rows.length > 0) {
      hits.push({
        table: col.table_name,
        column: col.column_name,
        sample: rows[0]?.sample ?? '',
      })
    }
  }

  return { hits, columnsScanned: scanned, tablesScanned: seenTables.size, truncated: false }
}

export function describeHits(hits: ScanHit[]): string {
  if (hits.length === 0) return 'no rows matched'
  return hits.map((h) => `${h.table}.${h.column}`).join(', ')
}
