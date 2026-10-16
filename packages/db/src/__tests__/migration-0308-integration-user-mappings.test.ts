import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0308 adds the table of provider accounts matched to teammates. It replays
// as a no-op, holds one teammate per account and one account per teammate on
// a connection, and goes with the connection or the teammate it names while a
// removed creator only blanks the creator. Runs in a rolled-back transaction
// against the migrated database.
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0308_integration_user_mappings.sql'),
  'utf8'
).replaceAll('--> statement-breakpoint', '')

const DB_URL = process.env.DATABASE_URL
const db: Database | null = DB_URL ? createDb(DB_URL, { max: 1 }) : null

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

class Rollback extends Error {}

describe.skipIf(!db)('migration 0308 integration user mappings', () => {
  it('replays, enforces both uniqueness rules and follows its owners on delete', async () => {
    await db!
      .transaction(async (tx) => {
        await tx.execute(sql.raw(MIGRATION))
        const [{ integration }] = (await tx.execute(sql`
          INSERT INTO "integrations" ("id", "integration_type", "status", "config")
          VALUES (gen_random_uuid(), 'github-0308', 'active', '{}'::jsonb)
          RETURNING "id" AS integration`)) as unknown as { integration: string }[]
        const principals = (await tx.execute(sql`
          INSERT INTO "principal" ("id", "type", "role", "display_name", "created_at")
          VALUES (gen_random_uuid(), 'user', 'member', 'Jane', now()),
                 (gen_random_uuid(), 'user', 'member', 'Ravi', now()),
                 (gen_random_uuid(), 'user', 'admin', 'Admin', now())
          RETURNING "id"`)) as unknown as { id: string }[]
        const [jane, ravi, admin] = principals.map((p) => p.id)
        const insert = (externalUserId: string, principalId: string) =>
          tx.execute(sql`
            INSERT INTO "integration_user_mappings"
              ("id", "integration_id", "external_user_id", "external_login", "principal_id", "created_by_principal_id")
            VALUES (gen_random_uuid(), ${integration}, ${externalUserId}, ${'login-' + externalUserId}, ${principalId}, ${admin})`)
        await insert('1', jane)
        await insert('2', ravi)

        const refused = async (externalUserId: string, principalId: string) => {
          await tx.execute(sql`SAVEPOINT attempt`)
          try {
            await insert(externalUserId, principalId)
            return false
          } catch {
            return true
          } finally {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT attempt`)
          }
        }
        expect(await refused('1', admin)).toBe(true)
        expect(await refused('3', jane)).toBe(true)

        // Replaying the migration over the populated table changes nothing.
        await tx.execute(sql.raw(MIGRATION))
        const count = async () =>
          Number(
            (
              (await tx.execute(
                sql`SELECT count(*)::int AS n FROM "integration_user_mappings" WHERE "integration_id" = ${integration}`
              )) as unknown as { n: number }[]
            )[0].n
          )
        expect(await count()).toBe(2)

        await tx.execute(sql`DELETE FROM "principal" WHERE "id" = ${admin}`)
        const creators = (await tx.execute(sql`
          SELECT DISTINCT "created_by_principal_id" AS creator FROM "integration_user_mappings"
          WHERE "integration_id" = ${integration}`)) as unknown as { creator: string | null }[]
        expect(creators).toEqual([{ creator: null }])

        await tx.execute(sql`DELETE FROM "principal" WHERE "id" = ${jane}`)
        expect(await count()).toBe(1)
        await tx.execute(sql`DELETE FROM "integrations" WHERE "id" = ${integration}`)
        expect(await count()).toBe(0)
        throw new Rollback()
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err
      })
  })
})
