import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0307 gives a GitHub connection's configured repository its first
// destination row, carrying the hook id, marks it as feeding the inbox only
// when the GitHub inbox channel is live, leaves config untouched, and replays
// as a no-op. Runs in a rolled-back transaction against the migrated database.
const MIGRATION = readFileSync(
  join(__dirname, '../../drizzle/0307_integration_destinations.sql'),
  'utf8'
).replaceAll('--> statement-breakpoint', '')

const DB_URL = process.env.DATABASE_URL
const db: Database | null = DB_URL ? createDb(DB_URL, { max: 1 }) : null

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!db)('migration 0307 integration destinations', () => {
  it('backfills the configured GitHub repository and replays as a no-op', async () => {
    await db!
      .transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM "integrations"`)
        await tx.execute(
          sql`UPDATE "channel_accounts" SET "deleted_at" = now() WHERE "channel" = 'github'`
        )
        const config = { channelId: 'acme/app', externalWebhookId: '41', webhookSecret: 's' }
        await tx.execute(sql`
          INSERT INTO "integrations" ("id", "integration_type", "status", "config")
          VALUES
            (gen_random_uuid(), 'github', 'active', ${JSON.stringify(config)}::jsonb),
            (gen_random_uuid(), 'linear', 'active', '{"channelId": "team/1"}'::jsonb),
            (gen_random_uuid(), 'gitlab', 'active', '{"channelId": "acme/app"}'::jsonb)`)

        const read = async () =>
          (await tx.execute(sql`
            SELECT i."integration_type" AS type, d."kind", d."external_id", d."external_webhook_id",
                   d."config", d."secrets", i."config" AS integration_config
            FROM "integration_destinations" d JOIN "integrations" i ON i."id" = d."integration_id"
            ORDER BY 1`)) as unknown as Record<string, unknown>[]

        await tx.execute(sql.raw(MIGRATION))
        const first = await read()
        expect(first).toEqual([
          {
            type: 'github',
            kind: 'repo',
            external_id: 'acme/app',
            external_webhook_id: '41',
            config: { inboundMode: 'off' },
            // SQL cannot encrypt: the secret stays on the connection for now.
            secrets: null,
            integration_config: config,
          },
        ])

        await tx.execute(sql.raw(MIGRATION))
        expect(await read()).toEqual(first)

        // With the GitHub inbox channel live, the repository feeds it.
        await tx.execute(sql`DELETE FROM "integration_destinations"`)
        await tx.execute(sql`
          INSERT INTO "teams" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000307', 'm0307')`)
        await tx.execute(sql`
          INSERT INTO "channel_accounts" ("id", "owning_team_id", "channel", "role", "config")
          VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000307', 'github', 'connection', '{}'::jsonb)`)
        await tx.execute(sql.raw(MIGRATION))
        expect((await read()).map((row) => row.config)).toEqual([{ inboundMode: 'conversations' }])

        // A connection with no repository chosen yet gets no row.
        await tx.execute(sql`DELETE FROM "integration_destinations"`)
        await tx.execute(
          sql`UPDATE "integrations" SET "config" = '{"channelId": ""}'::jsonb WHERE "integration_type" = 'github'`
        )
        await tx.execute(sql.raw(MIGRATION))
        expect(await read()).toEqual([])

        throw new Error('__ROLLBACK__')
      })
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== '__ROLLBACK__') throw error
      })
  })
})
