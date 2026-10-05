import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0294 marks every settings row that exists at upgrade time as already looked
// up, so automatic website branding only runs for workspaces created later.
// The rows are copied into a private schema inside a rolled-back transaction,
// so the migration's loop over "settings" sees only this test's rows.
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0294_website_branding_existing_workspaces.sql'),
  'utf8'
)

const DB_URL = process.env.DATABASE_URL
const db: Database | null = DB_URL ? createDb(DB_URL, { max: 1 }) : null

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const STORED = {
  absent: null,
  blank: '  ',
  jsonNull: 'null',
  sibling: JSON.stringify({ sibling: 'keep' }),
  looked: JSON.stringify({ brandingLookup: { status: 'applied' }, sibling: 'keep' }),
  unreadable: '{not json',
  array: '[1]',
} as const

describe.skipIf(!db)('migration 0294 existing workspaces skip website branding', () => {
  it('marks only unmarked object bags, keeps siblings, and replays as a no-op', async () => {
    await db!
      .transaction(async (tx) => {
        const schema = `m0294_${Date.now().toString(36)}`
        await tx.execute(sql.raw(`CREATE SCHEMA ${schema}`))
        await tx.execute(
          sql.raw(`CREATE TABLE ${schema}.settings (LIKE public.settings INCLUDING ALL)`)
        )
        await tx.execute(sql.raw(`SET LOCAL search_path = ${schema}, public`))
        for (const [slug, metadata] of Object.entries(STORED))
          await tx.execute(sql`
            INSERT INTO "settings" (id, name, slug, created_at, metadata)
            VALUES (gen_random_uuid(), 'Acme', ${slug}, now(), ${metadata})
          `)
        const read = async () =>
          Object.fromEntries(
            (
              (await tx.execute(sql`SELECT slug, metadata FROM "settings"`)) as unknown as {
                slug: string
                metadata: string | null
              }[]
            ).map((row) => [row.slug, row.metadata])
          )

        await tx.execute(sql.raw(MIGRATION))
        const first = await read()
        const marker = {
          version: 1,
          status: 'skipped',
          reason: 'existing',
          completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        }
        for (const slug of ['absent', 'blank', 'jsonNull'] as const)
          expect(JSON.parse(first[slug]!)).toEqual({ brandingLookup: marker })
        expect(JSON.parse(first.sibling!)).toEqual({ sibling: 'keep', brandingLookup: marker })
        expect(first.looked).toBe(STORED.looked)
        expect(first.unreadable).toBe(STORED.unreadable)
        expect(first.array).toBe(STORED.array)

        await tx.execute(sql.raw(MIGRATION))
        expect(await read()).toEqual(first)

        throw new Error('__ROLLBACK__')
      })
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== '__ROLLBACK__') throw error
      })
  })
})
