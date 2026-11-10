import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'

const migration = readFileSync(
  new URL('../../drizzle/0312_portal_design_preview_links.sql', import.meta.url),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)

const shape = (tx: Parameters<Parameters<ReturnType<typeof createDb>['transaction']>[0]>[0]) =>
  Promise.all([
    tx.execute(
      sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'portal_design_preview_links' ORDER BY column_name`
    ),
    tx.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename = 'portal_design_preview_links' ORDER BY indexname`
    ),
  ])

it('creates the preview link table with a unique token hash, and replays as a no-op', async () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test',
    { max: 1 }
  )
  const rollback = new Error('owned migration fixture rollback')
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP TABLE IF EXISTS portal_design_preview_links`)
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
        ['expires_at', 'NO'],
        ['id', 'NO'],
        ['revoked_at', 'YES'],
        ['token_hash', 'NO'],
      ])
      const tokenIndex = indexes.find((i) => String(i.indexdef).includes('(token_hash)'))
      expect(String(tokenIndex?.indexdef)).toMatch(/^CREATE UNIQUE INDEX/)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  }
})
