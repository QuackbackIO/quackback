import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0239 adds spam_filter_config. A workspace whose settings row exists when
 * the column is added (an upgrade from a release before it) stores the AI
 * classifier off; a row created afterwards stores nothing, which reads as on.
 * A replay finds the column and changes nothing. Applied against a scratch
 * table so a rewrite that opts upgraded workspaces in, or re-stamps later
 * rows on replay, fails here.
 */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0239_spam_filter_config.sql'),
  'utf8'
).replace(/"settings"/g, '"_m0239_settings"')

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

type Row = { name: string; spam_filter_config: string | null }

describe.skipIf(!dbAvailable)('migration 0239 spam filter config', () => {
  it('stores the AI classifier off for existing rows only, and replays as a no-op', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0239_settings" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "name" text NOT NULL
          )
        `)
        await tx.execute(sql`INSERT INTO "_m0239_settings" (name) VALUES ('existing')`)

        await tx.execute(sql.raw(MIGRATION_SQL))
        await tx.execute(sql`INSERT INTO "_m0239_settings" (name) VALUES ('created-later')`)
        await tx.execute(sql.raw(MIGRATION_SQL))

        const rows = (await tx.execute<Row>(
          sql`SELECT name, spam_filter_config FROM "_m0239_settings" ORDER BY name`
        )) as unknown as Row[]
        const by = Object.fromEntries(rows.map((r) => [r.name, r.spam_filter_config]))
        expect(JSON.parse(by.existing as string)).toEqual({
          trustedSenders: [],
          aiClassifier: false,
        })
        // Absent config reads as classifier on (parseSpamFilterConfig).
        expect(by['created-later']).toBeNull()

        throw new Error('rollback')
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'rollback') return
        throw err
      })
  })
})
