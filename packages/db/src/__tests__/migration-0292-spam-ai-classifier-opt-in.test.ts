import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0292 turns the AI spam classifier off for every workspace that exists at
 * upgrade time (keeping its trusted-sender list) and makes new rows default
 * to on. Applied twice against a scratch table so a rewrite that leaves an
 * upgraded workspace opted in, drops a trust list, or re-stamps a workspace
 * created after the upgrade fails here.
 */
const STATEMENTS = readFileSync(
  join(__dirname, '../../drizzle/0292_spam_ai_classifier_opt_in.sql'),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) =>
    s
      .replace(/"settings"/g, '"_m0292_settings"')
      .replace(/"kv_store"/g, '"_m0292_kv"')
      .trim()
  )
  .filter(Boolean)

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

type Row = { name: string; spam_filter_config: string }

describe.skipIf(!dbAvailable)('migration 0292 spam AI classifier opt-in', () => {
  it('stamps existing rows off, defaults new rows on, and replays as a no-op', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0292_settings" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "name" text NOT NULL,
            "spam_filter_config" text
          )
        `)
        await tx.execute(sql`CREATE TABLE "_m0292_kv" ("key" text PRIMARY KEY)`)
        await tx.execute(sql`
          INSERT INTO "_m0292_settings" (name, spam_filter_config) VALUES
            ('null', NULL),
            ('list', '{"trustedSenders":["acme.com"]}'),
            ('corrupt', 'not json')
        `)

        const run = async () => {
          for (const statement of STATEMENTS) await tx.execute(sql.raw(statement))
        }
        const read = async () =>
          Object.fromEntries(
            (
              (await tx.execute<Row>(
                sql`SELECT name, spam_filter_config FROM "_m0292_settings"`
              )) as unknown as Row[]
            ).map((r) => [r.name, JSON.parse(r.spam_filter_config)])
          )

        await run()
        await tx.execute(sql`INSERT INTO "_m0292_settings" (name) VALUES ('created-later')`)
        const first = await read()
        expect(first).toEqual({
          null: { aiClassifier: false },
          list: { trustedSenders: ['acme.com'], aiClassifier: false },
          corrupt: { aiClassifier: false },
          'created-later': { trustedSenders: [], aiClassifier: true },
        })

        await run()
        expect(await read()).toEqual(first)

        throw new Error('rollback')
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'rollback') return
        throw err
      })
  })
})
