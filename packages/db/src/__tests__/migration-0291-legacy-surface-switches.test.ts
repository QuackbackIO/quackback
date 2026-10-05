import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0291 carries the retired Help Center and Messenger master switches onto
 * the flag and the Messages tab, but only for flag blobs stored before those
 * switches were dropped (no `feedback` key). A workspace that kept a surface
 * switched off stays off; one whose flags were set under the current rules
 * keeps them. The file is applied twice against a scratch table so a
 * rewrite that publishes a disabled surface, or that is not a no-op on
 * replay, fails here.
 */
const STATEMENTS = readFileSync(
  join(__dirname, '../../drizzle/0291_legacy_surface_switches.sql'),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) =>
    s
      .replace(/"settings"/g, '"_m0291_settings"')
      .replace(/"kv_store"/g, '"_m0291_kv"')
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

const MESSENGER_OFF = JSON.stringify({
  enabled: true,
  tabs: { feedback: true, messenger: true },
  messenger: { enabled: false, welcomeMessage: 'hi' },
})

type Row = { name: string; feature_flags: string | null; widget_config: string | null }

describe.skipIf(!dbAvailable)('migration 0291 legacy surface switches', () => {
  it('keeps switched-off surfaces off for pre-switch flags only, and replays as a no-op', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0291_settings" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "name" text NOT NULL,
            "feature_flags" text,
            "help_center_config" text,
            "widget_config" text
          )
        `)
        await tx.execute(sql`CREATE TABLE "_m0291_kv" ("key" text PRIMARY KEY)`)
        await tx.execute(sql`INSERT INTO "_m0291_kv" VALUES ('settings:workspace')`)
        await tx.execute(sql`
          INSERT INTO "_m0291_settings" (name, feature_flags, help_center_config, widget_config) VALUES
            ('legacy-off', '{"helpCenter":true,"supportInbox":true}', '{"enabled":false}', ${MESSENGER_OFF}),
            ('legacy-no-hc-config', '{"helpCenter":true}', NULL, NULL),
            ('legacy-on', '{"helpCenter":true,"supportInbox":true}', '{"enabled":true}',
              '{"enabled":true,"tabs":{"messenger":true},"messenger":{"enabled":true}}'),
            ('current', '{"feedback":true,"helpCenter":true,"supportInbox":true}', '{"enabled":false}', ${MESSENGER_OFF}),
            ('corrupt', 'not json', '{"enabled":false}', NULL)
        `)

        for (const statement of STATEMENTS) await tx.execute(sql.raw(statement))
        const read = async () =>
          (await tx.execute<Row>(
            sql`SELECT name, feature_flags, widget_config FROM "_m0291_settings" ORDER BY name`
          )) as unknown as Row[]
        const first = await read()
        const by = Object.fromEntries(first.map((r) => [r.name, r]))
        const flags = (name: string) => JSON.parse(by[name].feature_flags as string)
        const widget = (name: string) => JSON.parse(by[name].widget_config as string)

        expect(flags('legacy-off')).toEqual({
          feedback: true,
          helpCenter: false,
          supportInbox: true,
        })
        expect(widget('legacy-off').tabs).toEqual({ feedback: true, messenger: false })
        expect(widget('legacy-off').messenger.welcomeMessage).toBe('hi')
        expect(flags('legacy-no-hc-config').helpCenter).toBe(false)

        expect(flags('legacy-on')).toEqual({ feedback: true, helpCenter: true, supportInbox: true })
        expect(widget('legacy-on').tabs.messenger).toBe(true)

        expect(flags('current')).toEqual({ feedback: true, helpCenter: true, supportInbox: true })
        expect(widget('current').tabs.messenger).toBe(true)
        expect(by.corrupt.feature_flags).toBe('not json')

        const kv = await tx.execute(sql`SELECT key FROM "_m0291_kv"`)
        expect(kv as unknown as unknown[]).toHaveLength(0)

        await tx.execute(sql`INSERT INTO "_m0291_kv" VALUES ('settings:workspace')`)
        for (const statement of STATEMENTS) await tx.execute(sql.raw(statement))
        expect(await read()).toEqual(first)
        const kvAfterReplay = await tx.execute(sql`SELECT key FROM "_m0291_kv"`)
        expect(kvAfterReplay as unknown as unknown[]).toHaveLength(1)

        throw new Error('rollback')
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'rollback') return
        throw err
      })
  })
})
