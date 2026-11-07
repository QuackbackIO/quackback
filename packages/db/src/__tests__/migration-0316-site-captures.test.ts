import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'

const migration = readFileSync(
  new URL('../../drizzle/0316_site_captures.sql', import.meta.url),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)

const shape = (tx: Parameters<Parameters<ReturnType<typeof createDb>['transaction']>[0]>[0]) =>
  Promise.all([
    tx.execute(
      sql`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_name IN ('site_captures', 'site_capture_calls')
          ORDER BY table_name, column_name`
    ),
    tx.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename IN ('site_captures', 'site_capture_calls') ORDER BY indexname`
    ),
  ])

it('creates the site capture tables and replays as a no-op', async () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test',
    { max: 1 }
  )
  const rollback = new Error('owned migration fixture rollback')
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP TABLE IF EXISTS site_captures`)
      await tx.execute(sql`DROP TABLE IF EXISTS site_capture_calls`)
      for (const statement of migration) await tx.execute(sql.raw(statement))
      const first = await shape(tx)
      // A second run is the fleet gap-heal replay: it must change nothing.
      for (const statement of migration) await tx.execute(sql.raw(statement))
      expect(await shape(tx)).toEqual(first)

      const [columns, indexes] = first
      expect(
        columns.filter((c) => c.table_name === 'site_capture_calls').map((c) => c.column_name)
      ).toEqual(['billed', 'created_at', 'host', 'id', 'outcome', 'principal_id'])
      expect(indexes.map((i) => i.indexname)).toEqual(
        expect.arrayContaining([
          'site_capture_calls_created_at_idx',
          'site_capture_calls_principal_created_idx',
          'site_capture_calls_host_created_idx',
          'site_captures_pkey',
        ])
      )
      // Only ok and failed rows are kept.
      const checks = await tx.execute(
        sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'site_captures_status_check'`
      )
      expect(String(checks[0]?.def)).toMatch(/ok.*failed/)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  }
})
