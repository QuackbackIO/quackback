import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0309 adds the table of ticket replies mirrored as comments on linked issues.
// It replays as a no-op, holds one comment per reply and linked issue and one
// message per comment and linked issue (a comment on an issue linked to two
// tickets stands for a message on each), and goes with the reply, the link or
// the connection it names. Runs in a rolled-back transaction against the migrated
// database.
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0309_message_external_links.sql'),
  'utf8'
).replaceAll('--> statement-breakpoint', '')

const DB_URL = process.env.DATABASE_URL
const db: Database | null = DB_URL ? createDb(DB_URL, { max: 1 }) : null

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

class Rollback extends Error {}

describe.skipIf(!db)('migration 0309 message external links', () => {
  it('replays, enforces both uniqueness rules and follows its owners on delete', async () => {
    await db!
      .transaction(async (tx) => {
        await tx.execute(sql.raw(MIGRATION))
        const one = async (query: ReturnType<typeof sql>) =>
          ((await tx.execute(query)) as unknown as { id: string }[])[0].id
        const integration = await one(sql`
          INSERT INTO "integrations" ("id", "integration_type", "status", "config")
          VALUES (gen_random_uuid(), 'github-0309', 'active', '{}'::jsonb) RETURNING "id"`)
        const status = await one(sql`
          INSERT INTO "ticket_statuses" ("id", "name", "slug", "category", "position")
          VALUES (gen_random_uuid(), 'Open', ${'open_0309_' + Date.now()}, 'open', 999) RETURNING "id"`)
        const ticket = await one(sql`
          INSERT INTO "tickets" ("id", "type", "title", "status_id")
          VALUES (gen_random_uuid(), 'customer', 'Export fails', ${status}) RETURNING "id"`)
        const link = async (issue: string) =>
          one(sql`
            INSERT INTO "ticket_external_links" ("id", "ticket_id", "integration_id", "integration_type", "external_id")
            VALUES (gen_random_uuid(), ${ticket}, ${integration}, 'github', ${issue}) RETURNING "id"`)
        const [api, web] = [await link('1'), await link('2')]
        const message = async () =>
          one(sql`
            INSERT INTO "conversation_messages" ("id", "ticket_id", "sender_type", "content")
            VALUES (gen_random_uuid(), ${ticket}, 'agent', 'Fixed.') RETURNING "id"`)
        const [first, second] = [await message(), await message()]
        const insert = (messageId: string, linkId: string, commentId: string) =>
          tx.execute(sql`
            INSERT INTO "message_external_links"
              ("id", "message_id", "ticket_external_link_id", "integration_id", "sync_scope", "external_id")
            VALUES (gen_random_uuid(), ${messageId}, ${linkId}, ${integration}, 'scope', ${commentId})`)
        await insert(first, api, '101')
        await insert(first, web, '102')
        await insert(second, api, '103')

        const refused = async (messageId: string, linkId: string, commentId: string) => {
          await tx.execute(sql`SAVEPOINT attempt`)
          try {
            await insert(messageId, linkId, commentId)
            return false
          } catch {
            return true
          } finally {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT attempt`)
          }
        }
        // A second comment for one reply on one issue, and one comment for two
        // messages on one issue; the same comment on another linked issue is fine.
        expect(await refused(first, api, '104')).toBe(true)
        expect(await refused(second, api, '101')).toBe(true)
        expect(await refused(second, web, '103')).toBe(false)

        // Replaying the migration over the populated table changes nothing.
        await tx.execute(sql.raw(MIGRATION))
        const count = async () =>
          Number(
            (
              (await tx.execute(
                sql`SELECT count(*)::int AS n FROM "message_external_links" WHERE "integration_id" = ${integration}`
              )) as unknown as { n: number }[]
            )[0].n
          )
        expect(await count()).toBe(3)
        const defaults = (await tx.execute(sql`
          SELECT DISTINCT "direction", "status" FROM "message_external_links"
          WHERE "integration_id" = ${integration}`)) as unknown as {
          direction: string
          status: string
        }[]
        expect(defaults).toEqual([{ direction: 'outbound', status: 'active' }])

        await tx.execute(sql`DELETE FROM "conversation_messages" WHERE "id" = ${second}`)
        expect(await count()).toBe(2)
        await tx.execute(sql`DELETE FROM "ticket_external_links" WHERE "id" = ${web}`)
        expect(await count()).toBe(1)
        // The connection's own delete is read off the constraint: deleting an
        // integrations row here would lock every table that references it,
        // against the other migration tests running beside this one.
        const onDelete = (await tx.execute(sql`
          SELECT confdeltype AS action FROM pg_constraint
          WHERE conname = 'message_external_links_integration_id_fkey'`)) as unknown as {
          action: string
        }[]
        expect(onDelete).toEqual([{ action: 'c' }])
        throw new Rollback()
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err
      })
  })
})
