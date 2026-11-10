import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'

const migration = readFileSync(
  new URL('../../drizzle/0313_portal_design_draft_version.sql', import.meta.url),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)

const column = (tx: Parameters<Parameters<ReturnType<typeof createDb>['transaction']>[0]>[0]) =>
  tx.execute(
    sql`SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'portal_designs' AND column_name = 'draft_version'`
  )

it('adds a draft version that starts at 0 on existing designs, and replays as a no-op', async () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test',
    { max: 1 }
  )
  const rollback = new Error('owned migration fixture rollback')
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE portal_designs DROP COLUMN IF EXISTS draft_version`)
      await tx.execute(sql`DELETE FROM portal_designs`)
      await tx.execute(sql`INSERT INTO portal_designs (id) VALUES (gen_random_uuid())`)
      for (const statement of migration) await tx.execute(sql.raw(statement))
      const first = await column(tx)
      // A second run is the fleet gap-heal replay: it must change nothing.
      for (const statement of migration) await tx.execute(sql.raw(statement))
      expect(await column(tx)).toEqual(first)

      expect(first.map((c) => [c.data_type, c.is_nullable, c.column_default])).toEqual([
        ['integer', 'NO', '0'],
      ])
      const rows = await tx.execute(sql`SELECT draft_version FROM portal_designs`)
      expect(rows.map((r) => r.draft_version)).toEqual([0])
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  }
})
