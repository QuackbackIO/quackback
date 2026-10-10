import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0263 writes core-only product flags onto rows that never persisted them, so
 * a 0.13.x upgrade does not turn Support, Help Center, or Status on. Stored
 * blobs are left alone. The statement is read from disk and pointed at a
 * scratch table so a change that stamped those products on fails here.
 */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0263_core_product_flag_defaults.sql'),
  'utf8'
)
const SCRATCH_SQL = MIGRATION_SQL.replace(/"settings"/g, '"_m0263_settings"')

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const CORE_ONLY = {
  feedback: true,
  changelog: true,
  helpCenter: false,
  supportInbox: false,
  supportTickets: false,
  statusPage: false,
}

describe.skipIf(!dbAvailable)('migration 0263 core product flag defaults', () => {
  it('stamps core-only flags onto null or empty rows and leaves stored blobs alone', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0263_settings" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "feature_flags" text
          )
        `)
        await tx.execute(sql`
          INSERT INTO "_m0263_settings" (id, feature_flags) VALUES
            (gen_random_uuid(), NULL),
            (gen_random_uuid(), ''),
            (gen_random_uuid(), 'null'),
            (gen_random_uuid(), '{"helpCenter":true,"supportInbox":true}')
        `)

        await tx.execute(sql.raw(SCRATCH_SQL))

        const rows = await tx.execute<{ feature_flags: string }>(
          sql`SELECT feature_flags FROM "_m0263_settings" ORDER BY feature_flags NULLS FIRST`
        )
        const flags = (rows as unknown as { feature_flags: string }[]).map((r) =>
          JSON.parse(r.feature_flags)
        )

        const stamped = flags.filter(
          (f) => f.helpCenter === false && f.supportInbox === false && f.statusPage === false
        )
        expect(stamped).toHaveLength(3)
        for (const blob of stamped) {
          expect(blob).toMatchObject(CORE_ONLY)
        }

        const kept = flags.find((f) => f.helpCenter === true)
        expect(kept).toEqual({ helpCenter: true, supportInbox: true })

        throw new Error('rollback')
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'rollback') return
        throw err
      })
  })
})
