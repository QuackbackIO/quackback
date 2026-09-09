import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0277 copies leftover 0.13.x widget `chat` keys onto `messenger` and turns
 * canned replies into macros. The file is applied verbatim against scratch
 * tables so a rewrite that dropped welcome copy or double-inserted macros
 * fails here rather than on a self-host upgrade.
 */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0277_widget_chat_to_messenger.sql'),
  'utf8'
)
const SCRATCH_SQL = MIGRATION_SQL.replace(/"settings"/g, '"_m0277_settings"').replace(
  /"macros"/g,
  '"_m0277_macros"'
)

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

const LEGACY_CHAT = JSON.stringify({
  enabled: true,
  tabs: { feedback: true, changelog: true, chat: true, home: true },
  chat: {
    enabled: true,
    welcomeMessage: 'Hi from the old chat tab',
    offlineMessage: 'We are away',
    teamName: 'Support',
    preChatEmail: 'optional',
    officeHours: { enabled: true, timezone: 'Europe/London', days: [] },
    cannedReplies: [
      { title: 'Thanks', body: 'Thanks for writing in.' },
      { title: 'Missing body', body: '' },
    ],
  },
})

const MESSENGER_WINS = JSON.stringify({
  enabled: true,
  tabs: { feedback: true, chat: true, messenger: false },
  chat: {
    welcomeMessage: 'Legacy welcome',
    cannedReplies: [{ title: 'Old', body: 'From chat' }],
  },
  messenger: {
    enabled: true,
    welcomeMessage: 'Already migrated',
    cannedReplies: [{ title: 'New', body: 'From messenger' }],
  },
})

const MESSENGER_ONLY = JSON.stringify({
  enabled: true,
  tabs: { feedback: true, messenger: true },
  messenger: {
    enabled: true,
    cannedReplies: [{ title: 'Already imported', body: 'Do not recreate' }],
  },
})

async function withScratch(
  run: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<void>
) {
  if (!db) return
  await db
    .transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE "_m0277_settings" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "widget_config" text
        )
      `)
      await tx.execute(sql`
        CREATE TABLE "_m0277_macros" (
          "id" uuid PRIMARY KEY,
          "name" text NOT NULL,
          "body" text NOT NULL,
          "scope" text NOT NULL DEFAULT 'support',
          "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "created_at" timestamptz NOT NULL DEFAULT now(),
          "updated_at" timestamptz NOT NULL DEFAULT now(),
          "deleted_at" timestamptz
        )
      `)
      await run(tx)
      throw new Error('rollback')
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === 'rollback') return
      throw err
    })
}

describe.skipIf(!dbAvailable)('migration 0277 widget chat to messenger', () => {
  it('rewrites chat onto messenger, copies canned replies once, and no-ops on replay', async () => {
    await withScratch(async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO "_m0277_settings" (id, widget_config) VALUES
          (gen_random_uuid(), ${LEGACY_CHAT}),
          (gen_random_uuid(), ${MESSENGER_WINS}),
          (gen_random_uuid(), '{"enabled":true,"tabs":{"feedback":true}}'),
          (gen_random_uuid(), ${MESSENGER_ONLY})
        RETURNING id
      `)
      const ids = (inserted as unknown as { id: string }[]).map((r) => r.id)

      await tx.execute(sql`
        INSERT INTO "_m0277_macros" (id, name, body, scope)
        VALUES (gen_random_uuid(), 'Old', 'From chat', 'feedback')
      `)

      await tx.execute(sql.raw(SCRATCH_SQL))
      await tx.execute(sql.raw(SCRATCH_SQL))

      const rows = await tx.execute<{ id: string; widget_config: string }>(
        sql`SELECT id, widget_config FROM "_m0277_settings"`
      )
      const byId = new Map(
        (rows as unknown as { id: string; widget_config: string }[]).map((r) => [
          r.id,
          JSON.parse(r.widget_config) as Record<string, unknown>,
        ])
      )

      const legacy = byId.get(ids[0]!)!
      expect(legacy).not.toHaveProperty('chat')
      expect((legacy.tabs as { chat?: unknown; messenger?: boolean }).chat).toBeUndefined()
      expect((legacy.tabs as { messenger?: boolean }).messenger).toBe(true)
      const messenger = legacy.messenger as {
        welcomeMessage: string
        offlineMessage: string
        teamName: string
        preChatEmail?: string
        officeHours: { timezone: string }
        cannedReplies: Array<{ title: string; body: string }>
      }
      expect(messenger.welcomeMessage).toBe('Hi from the old chat tab')
      expect(messenger.offlineMessage).toBe('We are away')
      expect(messenger.teamName).toBe('Support')
      expect(messenger.preChatEmail).toBeUndefined()
      expect(messenger.officeHours.timezone).toBe('Europe/London')
      expect(messenger.cannedReplies).toEqual([
        { title: 'Thanks', body: 'Thanks for writing in.' },
        { title: 'Missing body', body: '' },
      ])

      const overlay = byId.get(ids[1]!)!
      expect(overlay).not.toHaveProperty('chat')
      expect((overlay.tabs as { messenger?: boolean }).messenger).toBe(false)
      expect((overlay.messenger as { welcomeMessage: string }).welcomeMessage).toBe(
        'Already migrated'
      )

      const untouched = byId.get(ids[2]!)!
      expect(untouched).toEqual({ enabled: true, tabs: { feedback: true } })

      const messengerOnly = byId.get(ids[3]!)!
      expect(messengerOnly).toEqual(JSON.parse(MESSENGER_ONLY))

      const macros = await tx.execute<{ name: string; body: string; scope: string }>(
        sql`SELECT name, body, scope FROM "_m0277_macros" ORDER BY name, body, scope`
      )
      expect(macros as unknown as { name: string; body: string; scope: string }[]).toEqual([
        { name: 'Old', body: 'From chat', scope: 'feedback' },
        { name: 'Thanks', body: 'Thanks for writing in.', scope: 'support' },
      ])
    })
  })
})
