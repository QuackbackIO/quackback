import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0327 labels every existing help center collection with the workspace's
 * main language as it adds the column: a collection row held only
 * main-language text until then. The file runs against scratch tables, once
 * per kind of stored settings, and a second time after a collection changes
 * language, so a backfill that ignores the main language, fails on settings
 * that are not JSON, or rewrites labels on replay fails here.
 */
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0327_kb_categories_locale.sql'),
  'utf8'
)
  .replace(/"settings"/g, '"_m0327_settings"')
  .replace(/"kb_categories"/g, '"_m0327_categories"')
  .replace(/'kb_categories'/g, "'_m0327_categories'")

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const ROLLBACK = new Error('rollback')

async function labelsAfterMigration(
  languageConfig: string | null,
  helpCenterConfig: string | null
): Promise<{ first: string[]; replayed: string[] }> {
  let result: { first: string[]; replayed: string[] } | null = null
  await db!
    .transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE "_m0327_settings" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "language_config" text,
          "help_center_config" text
        )
      `)
      await tx.execute(sql`
        CREATE TABLE "_m0327_categories" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "name" text NOT NULL
        )
      `)
      await tx.execute(
        sql`INSERT INTO "_m0327_settings" (language_config, help_center_config) VALUES (${languageConfig}, ${helpCenterConfig})`
      )
      await tx.execute(sql`INSERT INTO "_m0327_categories" (name) VALUES ('a'), ('b')`)
      const read = async () =>
        (
          (await tx.execute<{ locale: string }>(
            sql`SELECT locale FROM "_m0327_categories" ORDER BY name`
          )) as unknown as { locale: string }[]
        ).map((r) => r.locale)

      await tx.execute(sql.raw(MIGRATION))
      const first = await read()
      await tx.execute(sql`UPDATE "_m0327_categories" SET locale = 'nl' WHERE name = 'b'`)
      await tx.execute(sql.raw(MIGRATION))
      result = { first, replayed: await read() }
      throw ROLLBACK
    })
    .catch((err) => {
      if (err !== ROLLBACK) throw err
    })
  return result!
}

describe.skipIf(!dbAvailable)('migration 0327 kb_categories locale', () => {
  it('labels existing collections with the main language from the language settings', async () => {
    const r = await labelsAfterMigration(
      '{"mainLanguage":"de","visitorLanguage":"own"}',
      '{"locales":{"default":"fr"}}'
    )
    expect(r.first).toEqual(['de', 'de'])
    expect(r.replayed).toEqual(['de', 'nl'])
  })

  it("falls back to the help center's default language, then English", async () => {
    expect((await labelsAfterMigration(null, '{"locales":{"default":"fr"}}')).first).toEqual([
      'fr',
      'fr',
    ])
    expect((await labelsAfterMigration('not json', '{"locales":{"default":"es"}}')).first).toEqual([
      'es',
      'es',
    ])
    expect((await labelsAfterMigration('{"mainLanguage":"xx"}', 'not json')).first).toEqual([
      'en',
      'en',
    ])
    expect((await labelsAfterMigration(null, null)).first).toEqual(['en', 'en'])
  })
})
