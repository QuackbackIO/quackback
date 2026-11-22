import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0323 clears the header name and header display mode saved before the portal
// header read them again, once per database. A second run (a ledger replay)
// must leave values saved afterwards alone, on old rows and new ones alike.
// The rows are copied into a private schema inside a rolled-back transaction,
// so the migration sees only this test's rows.
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0323_clear_legacy_header_settings.sql'),
  'utf8'
)

const DB_URL = process.env.DATABASE_URL
const db: Database | null = DB_URL ? createDb(DB_URL, { max: 1 }) : null

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

type Row = {
  slug: string
  header_display_name: string | null
  header_display_mode: string | null
  header_logo_key: string | null
}

const STORED: Row[] = [
  {
    slug: 'wordmark',
    header_display_name: 'Old Name',
    header_display_mode: 'custom_logo',
    header_logo_key: 'logos/old-wordmark.png',
  },
  {
    slug: 'logo-only',
    header_display_name: null,
    header_display_mode: 'logo_only',
    header_logo_key: null,
  },
  {
    slug: 'unset-mode',
    header_display_name: '  ',
    header_display_mode: null,
    header_logo_key: null,
  },
  {
    slug: 'default',
    header_display_name: null,
    header_display_mode: 'logo_and_name',
    header_logo_key: null,
  },
]

describe.skipIf(!db)('migration 0323 clears legacy header settings', () => {
  it('clears the header name and mode once, keeps the header logo, and replays as a no-op', async () => {
    await db!
      .transaction(async (tx) => {
        const schema = `m0323_${Date.now().toString(36)}`
        await tx.execute(sql.raw(`CREATE SCHEMA ${schema}`))
        await tx.execute(
          sql.raw(`CREATE TABLE ${schema}.settings (LIKE public.settings INCLUDING ALL)`)
        )
        // LIKE ... INCLUDING ALL copies column comments, and the comment is the
        // migration's marker: start from a database that has not run it.
        await tx.execute(
          sql.raw(`COMMENT ON COLUMN ${schema}.settings.header_display_name IS NULL`)
        )
        await tx.execute(sql.raw(`SET LOCAL search_path = ${schema}, public`))
        for (const row of STORED)
          await tx.execute(sql`
            INSERT INTO "settings" (id, name, slug, created_at, header_display_name, header_display_mode, header_logo_key)
            VALUES (gen_random_uuid(), 'Acme', ${row.slug}, now(), ${row.header_display_name}, ${row.header_display_mode}, ${row.header_logo_key})
          `)
        const read = async () =>
          Object.fromEntries(
            (
              (await tx.execute(
                sql`SELECT slug, header_display_name, header_display_mode, header_logo_key FROM "settings"`
              )) as unknown as Row[]
            ).map((row) => [row.slug, row])
          )

        await tx.execute(sql.raw(MIGRATION))
        const first = await read()
        for (const row of STORED)
          expect(first[row.slug]).toEqual({
            slug: row.slug,
            header_display_name: null,
            header_display_mode: 'logo_and_name',
            header_logo_key: row.header_logo_key,
          })

        // Values saved after the migration, through the new editor, on an old
        // row and on a row created later.
        await tx.execute(sql`
          UPDATE "settings"
          SET header_display_name = 'New Name', header_display_mode = 'custom_logo'
          WHERE slug = 'wordmark'
        `)
        await tx.execute(sql`
          INSERT INTO "settings" (id, name, slug, created_at, header_display_name, header_display_mode)
          VALUES (gen_random_uuid(), 'Later', 'later', now(), 'Later Name', 'custom_logo')
        `)
        const saved = await read()

        await tx.execute(sql.raw(MIGRATION))
        expect(await read()).toEqual(saved)
        expect(saved.wordmark.header_display_name).toBe('New Name')
        expect(saved.later.header_display_mode).toBe('custom_logo')

        throw new Error('__ROLLBACK__')
      })
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== '__ROLLBACK__') throw error
      })
  })
})
