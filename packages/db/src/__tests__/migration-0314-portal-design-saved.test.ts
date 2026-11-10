import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'

const migration = readFileSync(
  new URL('../../drizzle/0314_portal_design_saved.sql', import.meta.url),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)

const shape = (tx: Parameters<Parameters<ReturnType<typeof createDb>['transaction']>[0]>[0]) =>
  Promise.all([
    tx.execute(
      sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'portal_design_saved' ORDER BY column_name`
    ),
    tx.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename = 'portal_design_saved' ORDER BY indexname`
    ),
  ])

it('creates the saved design table, keeping only checkpoints and looks, and replays as a no-op', async () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test',
    { max: 1 }
  )
  const rollback = new Error('owned migration fixture rollback')
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP TABLE IF EXISTS portal_design_saved`)
      for (const statement of migration) await tx.execute(sql.raw(statement))
      const first = await shape(tx)
      // A second run is the fleet gap-heal replay: it must change nothing.
      for (const statement of migration) await tx.execute(sql.raw(statement))
      expect(await shape(tx)).toEqual(first)

      const [columns, indexes] = first
      expect(columns.map((c) => [c.column_name, c.is_nullable])).toEqual([
        ['created_at', 'NO'],
        ['created_by_principal_id', 'YES'],
        ['design_id', 'NO'],
        ['document', 'NO'],
        ['id', 'NO'],
        ['kind', 'NO'],
        ['name', 'NO'],
      ])
      expect(indexes.map((i) => i.indexname)).toContain('portal_design_saved_design_kind_idx')
      // Only checkpoints and looks are kept.
      const checks = await tx.execute(
        sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'portal_design_saved_kind_check'`
      )
      expect(String(checks[0]?.def)).toMatch(/checkpoint.*look/)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  }
})
